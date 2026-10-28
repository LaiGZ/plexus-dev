import { randomUUID } from "node:crypto";
import type { ToolPreview } from "@plexus/contracts";
import { eq, inArray, max, ne } from "drizzle-orm";
import { config } from "../../config.js";
import { encryptJson } from "../../infra/crypto.js";
import { db } from "../../infra/db/client.js";
import { appGrants, invocations, sources, tools } from "../../infra/db/schema.js";
import { badRequest, notFound } from "../../infra/errors.js";
import type { AuthConfig } from "../invoke/request-builder.js";
import { listMcpTools, mcpAuthFor } from "./mcp.js";
import { AppExport } from "@plexus/contracts";
import type {
  AddToolInput,
  AppExportTool,
  CreateSourceInput,
  ImportDiff,
  SourceDetail,
  SourceSummary,
  ToolDraft,
  ToolSummary,
  ToolUsage,
  UpdateSourceInput,
  UpdateToolInput,
} from "@plexus/contracts";

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "source";
}

/** MCP tool names must match `[A-Za-z0-9_-]{1,64}` and stay stable over time. */
export function mcpNameFor(slug: string, name: string, taken: Set<string>): string {
  const base = `${slug}__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    const tail = `_${suffix}`;
    candidate = `${base.slice(0, 64 - tail.length)}${tail}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

export function draftToPreview(slug: string, draft: ToolDraft, taken: Set<string>): ToolPreview {
  return {
    name: draft.name,
    mcpName: mcpNameFor(slug, draft.name, taken),
    description: draft.description,
    method: draft.method.toUpperCase(),
    path: draft.path,
    sideEffect: draft.sideEffect,
    inputSchema: draft.inputSchema ?? { type: "object", properties: {} },
  };
}

async function takenMcpNames(): Promise<Set<string>> {
  const rows = await db.select({ mcpName: tools.mcpName }).from(tools);
  return new Set(rows.map((r) => r.mcpName));
}

function toToolSummary(
  row: typeof tools.$inferSelect,
  sourceName: string,
  slug: string,
): ToolSummary {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName,
    displayName: `${slug}.${row.name}`,
    name: row.name,
    mcpName: row.mcpName,
    description: row.description,
    method: row.method,
    path: row.path,
    sideEffect: row.sideEffect === "write" ? "write" : "read",
    exposed: row.exposed,
    enabled: row.enabled,
    inputSchema: (() => {
      try {
        return JSON.parse(row.inputSchema) as unknown;
      } catch {
        return { type: "object", properties: {} };
      }
    })(),
  };
}

function toSourceSummary(
  row: typeof sources.$inferSelect,
  counts: { toolCount: number; exposedCount: number; lastInvokedAt: Date | null },
): SourceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind === "openapi" ? "openapi" : row.kind === "mcp" ? "mcp" : "http",
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    authType: row.authType,
    toolCount: counts.toolCount,
    exposedCount: counts.exposedCount,
    lastInvokedAt: counts.lastInvokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSources(): Promise<SourceSummary[]> {
  const [sourceRows, toolRows, lastRows] = await Promise.all([
    db.select().from(sources),
    db.select({ sourceId: tools.sourceId, exposed: tools.exposed }).from(tools),
    db
      .select({ sourceId: invocations.sourceId, last: max(invocations.ts) })
      .from(invocations)
      .groupBy(invocations.sourceId),
  ]);

  const counts = new Map<string, { toolCount: number; exposedCount: number }>();
  for (const row of toolRows) {
    const entry = counts.get(row.sourceId) ?? { toolCount: 0, exposedCount: 0 };
    entry.toolCount += 1;
    if (row.exposed) entry.exposedCount += 1;
    counts.set(row.sourceId, entry);
  }

  const lastBySource = new Map<string, Date | null>();
  for (const row of lastRows) {
    if (row.sourceId) {
      lastBySource.set(row.sourceId, row.last ? new Date(row.last) : null);
    }
  }

  return sourceRows
    .map((row) =>
      toSourceSummary(row, {
        toolCount: counts.get(row.id)?.toolCount ?? 0,
        exposedCount: counts.get(row.id)?.exposedCount ?? 0,
        lastInvokedAt: lastBySource.get(row.id) ?? null,
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSource(id: string): Promise<SourceDetail> {
  const row = (await db.select().from(sources).where(eqId(id)).limit(1))[0];
  if (!row) throw notFound("Source not found");

  const toolRows = await db.select().from(tools).where(eqSourceId(id));
  const last = (
    await db
      .select({ last: max(invocations.ts) })
      .from(invocations)
      .where(eqInvocationSource(id))
  )[0];

  return {
    source: toSourceSummary(row, {
      toolCount: toolRows.length,
      exposedCount: toolRows.filter((t) => t.exposed).length,
      lastInvokedAt: last?.last ? new Date(last.last) : null,
    }),
    tools: toolRows
      .map((tool) => toToolSummary(tool, row.name, row.slug))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function createSource(
  input: CreateSourceInput,
): Promise<{ source: SourceDetail["source"]; tools: ToolSummary[] }> {
  const taken = await takenMcpNames();

  const existingSlugs = new Set((await db.select({ slug: sources.slug }).from(sources)).map((s) => s.slug));
  let slug = slugify(input.name);
  let suffix = 2;
  while (existingSlugs.has(slug)) {
    slug = `${slugify(input.name)}-${suffix}`;
    suffix += 1;
  }

  const sourceId = randomUUID();
  const now = new Date();
  const auth: AuthConfig | null =
    input.auth && input.auth.type !== "none" ? (input.auth as AuthConfig) : null;

  await db.insert(sources).values({
    id: sourceId,
    name: input.name,
    slug,
    kind: input.kind,
    baseUrl: input.baseUrl,
    authType: input.auth?.type ?? "none",
    authEnc: auth ? encryptJson(auth, config.dataKey) : null,
    headers: JSON.stringify(input.headers ?? {}),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const seenNames = new Set<string>();
  const rows = input.tools.map((draft): typeof tools.$inferInsert => {
    const name = draft.name.trim();
    if (seenNames.has(name)) throw badRequest(`Duplicate tool name: ${name}`);
    seenNames.add(name);
    return {
      id: randomUUID(),
      sourceId,
      name,
      mcpName: mcpNameFor(slug, name, taken),
      description: draft.description,
      inputSchema: JSON.stringify(draft.inputSchema ?? { type: "object", properties: {} }),
      method: draft.method.toUpperCase(),
      path: draft.path,
      sideEffect: draft.sideEffect,
      idempotent: false,
      exposed: draft.exposed ?? input.exposeAll ?? false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  });

  await db.insert(tools).values(rows);

  return {
    source: {
      id: sourceId,
      name: input.name,
      slug,
      kind: input.kind,
      baseUrl: input.baseUrl,
      enabled: true,
      authType: input.auth?.type ?? "none",
      toolCount: rows.length,
      exposedCount: rows.filter((row) => row.exposed).length,
      lastInvokedAt: null,
      createdAt: now.toISOString(),
    },
    tools: rows.map((row) => toToolSummary(row as typeof tools.$inferSelect, input.name, slug)),
  };
}

export async function updateSource(id: string, input: UpdateSourceInput): Promise<SourceSummary> {
  const row = (await db.select().from(sources).where(eqId(id)).limit(1))[0];
  if (!row) throw notFound("Source not found");

  const patch: Partial<typeof sources.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.headers !== undefined) patch.headers = JSON.stringify(input.headers);
  if (input.auth !== undefined) {
    patch.authType = input.auth.type;
    patch.authEnc =
      input.auth.type === "none"
        ? null
        : encryptJson(input.auth as AuthConfig, config.dataKey);
  }

  await db.update(sources).set(patch).where(eqId(id));
  return (await getSource(id)).source;
}

export async function deleteSource(id: string): Promise<void> {
  const row = (await db.select().from(sources).where(eqId(id)).limit(1))[0];
  if (!row) throw notFound("Source not found");
  await db.delete(tools).where(eqSourceId(id));
  await db.delete(sources).where(eqId(id));
}

export async function addTool(sourceId: string, input: AddToolInput): Promise<ToolSummary> {
  const owner = (await db.select().from(sources).where(eqId(sourceId)).limit(1))[0];
  if (!owner) throw notFound("App not found");
  if (owner.kind === "mcp") {
    throw badRequest(
      "Methods of an MCP app are owned by the remote server",
      undefined,
      "Add the method on the remote MCP server, then re-import",
    );
  }

  const existing = await db.select({ name: tools.name }).from(tools).where(eqSourceId(sourceId));
  if (existing.some((row) => row.name === input.name)) {
    throw badRequest(`A method named ${input.name} already exists`);
  }

  const taken = await takenMcpNames();
  const now = new Date();
  const row: typeof tools.$inferInsert = {
    id: randomUUID(),
    sourceId,
    name: input.name,
    mcpName: mcpNameFor(owner.slug, input.name, taken),
    description: input.description,
    inputSchema: JSON.stringify(input.inputSchema ?? { type: "object", properties: {} }),
    method: input.method,
    path: input.path,
    sideEffect: input.sideEffect,
    idempotent: false,
    exposed: input.exposed,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(tools).values(row);
  return toToolSummary(row as typeof tools.$inferSelect, owner.name, owner.slug);
}

/** Pull tools from a remote MCP server and add the missing ones. */export async function syncMcpTools(
  sourceId: string,
): Promise<{ created: ToolSummary[]; skipped: string[] }> {
  const owner = (await db.select().from(sources).where(eqId(sourceId)).limit(1))[0];
  if (!owner) throw notFound("App not found");
  if (owner.kind !== "mcp") {
    throw badRequest("Only MCP apps can sync methods from a remote server");
  }

  const remote = await listMcpTools(owner.baseUrl, mcpAuthFor(owner.authEnc));
  const existingRows = await db
    .select({ name: tools.name })
    .from(tools)
    .where(eqSourceId(sourceId));
  const existing = new Set(existingRows.map((row) => row.name));
  const taken = await takenMcpNames();

  const created: ToolSummary[] = [];
  const skipped: string[] = [];
  const now = new Date();

  for (const tool of remote) {
    if (existing.has(tool.name)) {
      skipped.push(tool.name);
      continue;
    }
    const row: typeof tools.$inferInsert = {
      id: randomUUID(),
      sourceId,
      name: tool.name,
      mcpName: mcpNameFor(owner.slug, tool.name, taken),
      description: tool.description,
      inputSchema: JSON.stringify(tool.inputSchema),
      method: "POST",
      path: "/",
      sideEffect: tool.sideEffect,
      idempotent: false,
      exposed: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(tools).values(row);
    created.push(toToolSummary(row as typeof tools.$inferSelect, owner.name, owner.slug));
  }

  return { created, skipped };
}

export async function updateTool(id: string, input: UpdateToolInput): Promise<ToolSummary> {  const row = (await db.select().from(tools).where(eqToolId(id)).limit(1))[0];
  if (!row) throw notFound("Tool not found");

  const patch: Partial<typeof tools.$inferInsert> = { updatedAt: new Date() };
  if (input.exposed !== undefined) patch.exposed = input.exposed;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.sideEffect !== undefined) patch.sideEffect = input.sideEffect;
  if (input.description !== undefined) patch.description = input.description;
  if (input.inputSchema !== undefined) patch.inputSchema = JSON.stringify(input.inputSchema);
  if (input.method !== undefined) patch.method = input.method;
  if (input.path !== undefined) patch.path = input.path;

  if (input.name !== undefined && input.name !== row.name) {
    const owner = (await db.select().from(sources).where(eqId(row.sourceId)).limit(1))[0];
    if (!owner) throw notFound("App not found");
    if (owner.kind === "mcp") {
      throw badRequest(
        "MCP tools cannot be renamed",
        undefined,
        "The remote MCP server owns this tool name",
      );
    }

    const others = await db
      .select({ mcpName: tools.mcpName })
      .from(tools)
      .where(ne(tools.id, id));
    const taken = new Set(others.map((other) => other.mcpName));
    patch.name = input.name;
    patch.mcpName = mcpNameFor(owner.slug, input.name, taken);
  }

  await db.update(tools).set(patch).where(eqToolId(id));
  const updated = (await db.select().from(tools).where(eqToolId(id)).limit(1))[0];
  if (!updated) throw notFound("Tool not found");
  const owner = (
    await db
      .select({ name: sources.name, slug: sources.slug })
      .from(sources)
      .where(eqId(updated.sourceId))
      .limit(1)
  )[0];
  return toToolSummary(updated, owner?.name ?? updated.sourceId, owner?.slug ?? "app");
}

export async function listTools(sourceId?: string): Promise<ToolSummary[]> {
  const query = db
    .select({ tool: tools, sourceName: sources.name, slug: sources.slug })
    .from(tools)
    .innerJoin(sources, eq(tools.sourceId, sources.id));

  const rows = sourceId ? await query.where(eqSourceId(sourceId)) : await query;
  return rows
    .map(({ tool, sourceName, slug }) => toToolSummary(tool, sourceName, slug))
    .sort((a, b) => a.mcpName.localeCompare(b.mcpName));
}

export async function getAppGrants(sourceId: string): Promise<string[]> {
  const rows = await db.select().from(appGrants).where(eq(appGrants.sourceId, sourceId));
  return rows.map((row) => row.toolId);
}

/** Replace the set of tools an app may call through /gateway/invoke. */
export async function setAppGrants(sourceId: string, toolIds: string[]): Promise<string[]> {
  const source = (await db.select().from(sources).where(eqId(sourceId)).limit(1))[0];
  if (!source) throw notFound("App not found");

  const ids = [...new Set(toolIds)];
  const valid = ids.length
    ? (await db.select({ id: tools.id }).from(tools).where(inArray(tools.id, ids))).map(
        (row) => row.id,
      )
    : [];

  await db.delete(appGrants).where(eq(appGrants.sourceId, sourceId));
  if (valid.length) {
    await db.insert(appGrants).values(valid.map((toolId) => ({ sourceId, toolId })));
  }
  return valid;
}

function parseAppExport(text: string): AppExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw badRequest("File is not valid JSON", undefined, "Import a file produced by “Export config”");
  }
  const parsed = AppExport.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      "File is not a valid Plexus app export",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      "Use “Export config” to get a valid template",
    );
  }

  const names = new Set<string>();
  for (const tool of parsed.data.tools) {
    if (names.has(tool.name)) throw badRequest(`Duplicate method in file: ${tool.name}`);
    names.add(tool.name);
  }
  return parsed.data;
}

async function loadImport(sourceId: string, text: string) {
  const owner = (await db.select().from(sources).where(eqId(sourceId)).limit(1))[0];
  if (!owner) throw notFound("App not found");
  if (owner.kind === "mcp") {
    throw badRequest(
      "MCP apps are managed by the remote server",
      undefined,
      "Use “Sync from MCP” instead",
    );
  }

  const file = parseAppExport(text);
  if (file.app.id !== owner.id) {
    throw badRequest(
      "app_id_mismatch",
      { expected: owner.id, actual: file.app.id },
      "The file must be exported from this same app",
    );
  }
  return { owner, file };
}

function changedFields(
  existing: typeof tools.$inferSelect,
  incoming: AppExportTool,
): string[] {
  const fields: string[] = [];
  if (existing.description !== incoming.description) fields.push("description");
  if (existing.method !== incoming.method.toUpperCase()) fields.push("method");
  if (existing.path !== incoming.path) fields.push("path");
  if (existing.sideEffect !== incoming.sideEffect) fields.push("sideEffect");
  if (
    existing.inputSchema !==
    JSON.stringify(incoming.inputSchema ?? { type: "object", properties: {} })
  ) {
    fields.push("inputSchema");
  }
  if (existing.exposed !== incoming.exposed) fields.push("exposed");
  if (existing.enabled !== incoming.enabled) fields.push("enabled");
  return fields;
}

/** Parse an export file and describe exactly what applying it would change. */
export async function previewImport(sourceId: string, text: string): Promise<ImportDiff> {
  const { owner, file } = await loadImport(sourceId, text);
  const current = await db.select().from(tools).where(eqSourceId(sourceId));
  const byName = new Map(current.map((tool) => [tool.name, tool]));

  const added: ImportDiff["added"] = [];
  const updated: ImportDiff["updated"] = [];

  for (const tool of file.tools) {
    const existing = byName.get(tool.name);
    if (!existing) {
      added.push({
        name: tool.name,
        mcpName: mcpNameFor(owner.slug, tool.name, new Set()),
        description: tool.description,
        method: tool.method,
        path: tool.path,
        sideEffect: tool.sideEffect,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      });
      continue;
    }
    const fields = changedFields(existing, tool);
    if (fields.length) updated.push({ id: existing.id, name: tool.name, fields });
  }

  const keep = new Set(file.tools.map((tool) => tool.name));
  const removed = current
    .filter((tool) => !keep.has(tool.name))
    .map((tool) => ({ id: tool.id, name: tool.name }));

  const warnings: string[] = [];
  if (file.app.kind !== owner.kind) {
    warnings.push(
      `File kind (${file.app.kind}) differs from this app (${owner.kind}); the app kind is unchanged.`,
    );
  }

  if (removed.length) {
    const grants = await db
      .select({ toolId: appGrants.toolId, name: sources.name })
      .from(appGrants)
      .innerJoin(sources, eq(appGrants.sourceId, sources.id))
      .where(inArray(appGrants.toolId, removed.map((tool) => tool.id)));
    const byTool = new Map<string, string[]>();
    for (const grant of grants) {
      byTool.set(grant.toolId, [...(byTool.get(grant.toolId) ?? []), grant.name]);
    }
    for (const tool of removed) {
      const apps = byTool.get(tool.id);
      if (apps?.length) {
        warnings.push(
          `Removing ${tool.name} also revokes grants for: ${apps.join(", ")}.`,
        );
      }
    }
  }

  return {
    appId: owner.id,
    nameChange:
      file.app.name !== owner.name ? { from: owner.name, to: file.app.name } : null,
    baseUrlChange:
      file.app.baseUrl !== owner.baseUrl
        ? { from: owner.baseUrl, to: file.app.baseUrl }
        : null,
    added,
    updated,
    removed,
    warnings,
  };
}

/** Apply a previously previewed export (validated again before writing). */
export async function applyImport(
  sourceId: string,
  text: string,
  removeMissing: boolean,
): Promise<{ created: number; updated: number; removed: number }> {
  const { owner, file } = await loadImport(sourceId, text);
  const now = new Date();

  await db
    .update(sources)
    .set({ name: file.app.name, baseUrl: file.app.baseUrl, updatedAt: now })
    .where(eqId(sourceId));

  const current = await db.select().from(tools).where(eqSourceId(sourceId));
  const byName = new Map(current.map((tool) => [tool.name, tool]));
  const taken = await takenMcpNames();

  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const tool of file.tools) {
    const data = {
      description: tool.description,
      method: tool.method.toUpperCase(),
      path: tool.path,
      sideEffect: tool.sideEffect,
      inputSchema: JSON.stringify(
        tool.inputSchema ?? { type: "object", properties: {} },
      ),
      exposed: tool.exposed,
      enabled: tool.enabled,
      updatedAt: now,
    };
    const existing = byName.get(tool.name);
    if (existing) {
      await db.update(tools).set(data).where(eqToolId(existing.id));
      updated += 1;
    } else {
      await db.insert(tools).values({
        id: randomUUID(),
        sourceId,
        name: tool.name,
        mcpName: mcpNameFor(owner.slug, tool.name, taken),
        idempotent: false,
        createdAt: now,
        ...data,
      });
      created += 1;
    }
  }

  if (removeMissing) {
    const keep = new Set(file.tools.map((tool) => tool.name));
    for (const tool of current) {
      if (keep.has(tool.name)) continue;
      await db.delete(appGrants).where(eq(appGrants.toolId, tool.id));
      await db.delete(tools).where(eqToolId(tool.id));
      removed += 1;
    }
  }

  return { created, updated, removed };
}

/** What deleting a method would affect. */
export async function getToolUsage(toolId: string): Promise<ToolUsage> {
  const tool = (await db.select().from(tools).where(eqToolId(toolId)).limit(1))[0];
  if (!tool) throw notFound("Tool not found");

  const granted = await db
    .select({ id: sources.id, name: sources.name })
    .from(appGrants)
    .innerJoin(sources, eq(appGrants.sourceId, sources.id))
    .where(eq(appGrants.toolId, toolId));

  const calls = await db
    .select({ ts: invocations.ts })
    .from(invocations)
    .where(eq(invocations.toolId, toolId));

  const last = calls.reduce<Date | null>(
    (acc, row) => (!acc || row.ts > acc ? row.ts : acc),
    null,
  );

  return {
    grantedApps: granted,
    exposed: tool.exposed,
    invocationCount: calls.length,
    lastInvokedAt: last ? last.toISOString() : null,
  };
}

export async function deleteTool(toolId: string): Promise<void> {
  const tool = (await db.select().from(tools).where(eqToolId(toolId)).limit(1))[0];
  if (!tool) throw notFound("Tool not found");

  await db.delete(appGrants).where(eq(appGrants.toolId, toolId));
  await db.delete(tools).where(eqToolId(toolId));
}

// Small helpers keep the drizzle calls readable above.
function eqId(id: string) {
  return eq(sources.id, id);
}
function eqSourceId(id: string) {
  return eq(tools.sourceId, id);
}
function eqToolId(id: string) {
  return eq(tools.id, id);
}
function eqInvocationSource(id: string) {
  return eq(invocations.sourceId, id);
}
