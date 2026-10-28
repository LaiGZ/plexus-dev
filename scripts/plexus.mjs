#!/usr/bin/env node
/**
 * Plexus admin CLI — zero dependencies, one command per action.
 *
 *   node scripts/plexus.mjs apps list
 *   node scripts/plexus.mjs apps create --file my-app.yaml
 *   node scripts/plexus.mjs tools add finance --name createBill --method POST \
 *     --path /api/createBill --write --expose
 *
 * Global flags: --url, --user, --password, --json, --yes
 * Credentials default to PLEXUS_URL / PLEXUS_ADMIN_USERNAME / PLEXUS_ADMIN_PASSWORD.
 *
 * The CLI logs in per invocation (nothing is written to disk), prints human tables
 * by default and JSON with --json. Destructive actions require --yes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const GLOBAL_DEFAULTS = {
  url: process.env.PLEXUS_URL ?? "http://127.0.0.1:3000",
  user: process.env.PLEXUS_ADMIN_USERNAME ?? "plexus",
  password: process.env.PLEXUS_ADMIN_PASSWORD ?? "",
};

const OPTIONS = {
  url: { type: "string" },
  user: { type: "string" },
  password: { type: "string" },
  json: { type: "boolean" },
  yes: { type: "boolean" },
  help: { type: "boolean" },
  file: { type: "string" },
  out: { type: "string" },
  name: { type: "string" },
  method: { type: "string" },
  path: { type: "string" },
  description: { type: "string" },
  schema: { type: "string" },
  args: { type: "string" },
  scope: { type: "string" },
  apps: { type: "string" },
  app: { type: "string" },
  tools: { type: "string" },
  status: { type: "string" },
  actor: { type: "string" },
  limit: { type: "string" },
  read: { type: "boolean" },
  write: { type: "boolean" },
  expose: { type: "boolean" },
  off: { type: "boolean" },
  "remove-missing": { type: "boolean" },
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: OPTIONS,
  strict: false,
});

const BASE = (values.url ?? GLOBAL_DEFAULTS.url).replace(/\/+$/, "");
const JSON_OUT = Boolean(values.json);
const QUERY = positionals;
let cookie = "";

function out(value) {
  if (JSON_OUT) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

function table(rows, columns) {
  if (rows.length === 0) return "(empty)";
  const widths = columns.map((column) =>
    Math.max(column.label.length, ...rows.map((row) => String(row[column.key] ?? "").length)),
  );
  const line = (cells) =>
    cells.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join("  ");
  return [
    line(columns.map((column) => column.label)),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(columns.map((column) => row[column.key]))),
  ].join("\n");
}

async function login() {
  if (cookie) return;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "plexus" },
    body: JSON.stringify({ username: values.user ?? GLOBAL_DEFAULTS.user, password: values.password ?? GLOBAL_DEFAULTS.password }),
  });
  if (!res.ok) {
    throw new Error(
      `Login failed (${res.status}). Set PLEXUS_ADMIN_PASSWORD or pass --password.`,
    );
  }
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  cookie = cookies.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

async function api(path, init = {}) {
  await login();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  headers.set("x-requested-with", "plexus");
  headers.set("cookie", cookie);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const error = body?.error;
    throw new Error(
      `${init.method ?? "GET"} ${path} -> ${res.status} ${error?.message ?? text}`,
    );
  }
  return body;
}

async function resolveApp(ref) {
  if (!ref) throw new Error("Missing app id/name");
  const list = await api("/api/sources");
  const matches = list.sources.filter(
    (source) => source.id === ref || source.name === ref || source.slug === ref,
  );
  if (matches.length === 0) throw new Error(`App not found: ${ref}`);
  if (matches.length > 1) {
    throw new Error(`Ambiguous app "${ref}": ${matches.map((m) => m.id).join(", ")}`);
  }
  return api(`/api/sources/${matches[0].id}`);
}

async function resolveTool(ref) {
  if (!ref) throw new Error("Missing tool id/name");
  const list = await api("/api/tools");
  const matches = list.tools.filter(
    (tool) =>
      tool.id === ref ||
      tool.mcpName === ref ||
      tool.displayName === ref ||
      tool.name === ref,
  );
  if (matches.length === 0) throw new Error(`Tool not found: ${ref}`);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous tool "${ref}": ${matches.map((m) => m.displayName).join(", ")}`,
    );
  }
  return matches[0];
}

function printDiff(diff) {
  const lines = [];
  if (diff.nameChange) lines.push(`name: ${diff.nameChange.from} -> ${diff.nameChange.to}`);
  if (diff.baseUrlChange) {
    lines.push(`baseUrl: ${diff.baseUrlChange.from} -> ${diff.baseUrlChange.to}`);
  }
  if (diff.added.length) {
    lines.push(`add (${diff.added.length}): ${diff.added.map((t) => t.name).join(", ")}`);
  }
  if (diff.updated.length) {
    lines.push(
      `update (${diff.updated.length}): ${diff.updated
        .map((t) => `${t.name} [${t.fields.join(",")}]`)
        .join("; ")}`,
    );
  }
  if (diff.removed.length) {
    lines.push(`remove (${diff.removed.length}): ${diff.removed.map((t) => t.name).join(", ")}`);
  }
  if (diff.warnings.length) lines.push(...diff.warnings.map((w) => `warning: ${w}`));
  if (lines.length === 0) lines.push("no changes");
  return lines.join("\n");
}

const HELP = `plexus CLI

Usage:
  node scripts/plexus.mjs <group> <command> [options]

Apps:
  apps list
  apps get <app>
  apps create --file <template.yaml|json>
  apps import <app> --file <export.json> [--remove-missing] [--yes]
  apps export <app> [--out <file>]
  apps secret <app>

Tools:
  tools list [--app <app>]
  tools add <app> --name <n> --method <GET|POST|...> --path <p> [--write] [--expose] [--description <d>] [--schema <json>]
  tools expose <tool> [--off]
  tools enable <tool> [--off]
  tools delete <tool> --yes

Grants:
  grants list <app>
  grants set <app> --tools <tool1,tool2>

Tokens:
  tokens list
  tokens create --name <n> --scope read|write [--apps <app1,app2>]

Calls & logs:
  invoke <tool> --args '{"key":"value"}'
  logs [--app <app>] [--status ok|error|replayed] [--actor user|mcp|app|agent] [--limit 20]

Global:
  --url <base> --user <u> --password <p> --json --yes

Env: PLEXUS_URL, PLEXUS_ADMIN_USERNAME, PLEXUS_ADMIN_PASSWORD.
`;

async function main() {
  if (values.help || QUERY.length === 0) {
    out(HELP);
    return;
  }

  const [group, command, arg] = QUERY;

  if (group === "apps" && command === "list") {
    const { sources } = await api("/api/sources");
    if (JSON_OUT) return out(sources);
    out(
      table(sources, [
        { key: "id", label: "id" },
        { key: "name", label: "name" },
        { key: "kind", label: "kind" },
        { key: "toolCount", label: "tools" },
        { key: "exposedCount", label: "exposed" },
        { key: "enabled", label: "enabled" },
      ]),
    );
    return;
  }

  if (group === "apps" && command === "get") {
    const detail = await resolveApp(arg);
    if (JSON_OUT) return out(detail);
    out(`${detail.source.name} (${detail.source.id})`);
    out(`baseUrl: ${detail.source.baseUrl}  kind: ${detail.source.kind}  enabled: ${detail.source.enabled}`);
    out("");
    out(
      table(detail.tools, [
        { key: "displayName", label: "tool" },
        { key: "mcpName", label: "mcpName" },
        { key: "method", label: "method" },
        { key: "path", label: "path" },
        { key: "sideEffect", label: "effect" },
        { key: "exposed", label: "exposed" },
      ]),
    );
    return;
  }

  if (group === "apps" && command === "create") {
    if (!values.file) throw new Error("--file is required");
    const text = readFileSync(values.file, "utf8");
    const preview = await api("/api/templates/app/preview", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const created = await api("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: preview.app.name,
        kind: "http",
        baseUrl: preview.app.baseUrl,
        auth: preview.app.auth ?? { type: "none" },
        headers: preview.app.headers ?? {},
        exposeAll: false,
        tools: preview.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          method: tool.method,
          path: tool.path,
          sideEffect: tool.sideEffect,
          inputSchema: tool.inputSchema,
          exposed: tool.exposed ?? true,
        })),
      }),
    });
    if (JSON_OUT) return out(created);
    out(`created ${created.source.name} (${created.source.id}) with ${created.tools.length} methods`);
    out("app_id is generated by the platform.");
    return;
  }

  if (group === "apps" && command === "import") {
    if (!values.file) throw new Error("--file is required");
    const app = await resolveApp(arg);
    const text = readFileSync(values.file, "utf8");
    const diff = await api(`/api/sources/${app.source.id}/import/preview`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (!values.yes) {
      out(printDiff(diff));
      out("\nNot applied. Re-run with --yes to apply.");
      process.exitCode = 2;
      return;
    }
    const result = await api(`/api/sources/${app.source.id}/import`, {
      method: "POST",
      body: JSON.stringify({ text, removeMissing: Boolean(values["remove-missing"]) }),
    });
    out(
      JSON_OUT
        ? result
        : `applied: created ${result.created}, updated ${result.updated}, removed ${result.removed}`,
    );
    return;
  }

  if (group === "apps" && command === "export") {
    const app = await resolveApp(arg);
    const payload = {
      format: "plexus.app.v1",
      exportedAt: new Date().toISOString(),
      app: {
        id: app.source.id,
        name: app.source.name,
        kind: app.source.kind,
        baseUrl: app.source.baseUrl,
      },
      tools: app.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        sideEffect: tool.sideEffect,
        inputSchema: tool.inputSchema,
        exposed: tool.exposed,
        enabled: tool.enabled,
      })),
    };
    const text = JSON.stringify(payload, null, 2);
    if (values.out) {
      mkdirSync(dirname(values.out), { recursive: true });
      writeFileSync(values.out, text, "utf8");
      out(`wrote ${values.out}`);
    } else {
      out(text);
    }
    return;
  }

  if (group === "apps" && command === "secret") {
    const app = await resolveApp(arg);
    const result = await api(`/api/gateway/apps/${app.source.id}/secret`, { method: "POST" });
    out(`app_id: ${result.appId}`);
    out(`app_secret: ${result.secret}`);
    out("Shown once. Rotating it invalidates previously issued service tokens.");
    return;
  }

  if (group === "tools" && command === "list") {
    const query = values.app
      ? `/api/tools?sourceId=${encodeURIComponent((await resolveApp(values.app)).source.id)}`
      : "/api/tools";
    const { tools } = await api(query);
    if (JSON_OUT) return out(tools);
    out(
      table(tools, [
        { key: "displayName", label: "tool" },
        { key: "sourceName", label: "app" },
        { key: "sideEffect", label: "effect" },
        { key: "exposed", label: "exposed" },
        { key: "enabled", label: "enabled" },
      ]),
    );
    return;
  }

  if (group === "tools" && command === "add") {
    const app = await resolveApp(arg);
    if (!values.name || !values.path) throw new Error("--name and --path are required");
    let schema;
    if (values.schema) {
      try {
        schema = JSON.parse(values.schema);
      } catch {
        throw new Error("--schema must be valid JSON");
      }
    }
    const result = await api(`/api/sources/${app.source.id}/tools`, {
      method: "POST",
      body: JSON.stringify({
        name: values.name,
        description: values.description ?? "",
        method: (values.method ?? "POST").toUpperCase(),
        path: values.path,
        sideEffect: values.write ? "write" : "read",
        exposed: Boolean(values.expose),
        enabled: true,
        ...(schema ? { inputSchema: schema } : {}),
      }),
    });
    out(JSON_OUT ? result : `added ${result.tool.displayName} (${result.tool.mcpName})`);
    return;
  }

  if (group === "tools" && (command === "expose" || command === "enable")) {
    const tool = await resolveTool(arg);
    const patch = command === "expose" ? { exposed: !values.off } : { enabled: !values.off };
    const result = await api(`/api/tools/${tool.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    out(JSON_OUT ? result : `${result.tool.mcpName}: ${JSON.stringify(patch)}`);
    return;
  }

  if (group === "tools" && command === "delete") {
    const tool = await resolveTool(arg);
    const usage = await api(`/api/tools/${tool.id}/usage`);
    const lines = [`${tool.displayName} (${tool.mcpName})`];
    if (usage.grantedApps.length) {
      lines.push(`granted to: ${usage.grantedApps.map((app) => app.name).join(", ")}`);
    }
    if (usage.exposed) lines.push("currently exposed to the platform");
    lines.push(`historical calls: ${usage.invocationCount}`);
    if (!values.yes) {
      out(lines.join("\n"));
      out("\nNot deleted. Re-run with --yes to delete (grants are removed too).");
      process.exitCode = 2;
      return;
    }
    await api(`/api/tools/${tool.id}`, { method: "DELETE" });
    out(`deleted ${tool.mcpName}`);
    return;
  }

  if (group === "grants" && command === "list") {
    const app = await resolveApp(arg);
    const result = await api(`/api/sources/${app.source.id}/grants`);
    if (JSON_OUT) return out(result);
    if (result.toolIds.length === 0) return out("(none)");
    const { tools: all } = await api("/api/tools");
    const byId = new Map(all.map((tool) => [tool.id, tool.displayName]));
    out(result.toolIds.map((id) => byId.get(id) ?? id).join("\n"));
    return;
  }

  if (group === "grants" && command === "set") {
    const app = await resolveApp(arg);
    const refs = (values.tools ?? "").split(",").map((ref) => ref.trim()).filter(Boolean);
    const toolIds = [];
    for (const ref of refs) {
      toolIds.push((await resolveTool(ref)).id);
    }
    const result = await api(`/api/sources/${app.source.id}/grants`, {
      method: "PUT",
      body: JSON.stringify({ toolIds }),
    });
    out(`grants updated: ${result.toolIds.length}`);
    return;
  }

  if (group === "tokens" && command === "list") {
    const { tokens } = await api("/api/tokens");
    if (JSON_OUT) return out(tokens);
    out(
      table(tokens, [
        { key: "name", label: "name" },
        { key: "prefix", label: "prefix" },
        { key: "scope", label: "scope" },
        { key: "lastUsedAt", label: "lastUsed" },
      ]),
    );
    return;
  }

  if (group === "tokens" && command === "create") {
    if (!values.name) throw new Error("--name is required");
    const sourceIds = [];
    for (const ref of (values.apps ?? "").split(",").map((r) => r.trim()).filter(Boolean)) {
      sourceIds.push((await resolveApp(ref)).source.id);
    }
    const result = await api("/api/tokens", {
      method: "POST",
      body: JSON.stringify({
        name: values.name,
        scope: values.scope === "write" ? "write" : "read",
        sourceIds,
      }),
    });
    if (JSON_OUT) return out(result);
    out(`token: ${result.token}`);
    out("Shown once. Use it as: Authorization: Bearer <token> on POST /mcp.");
    return;
  }

  if (group === "invoke") {
    const tool = await resolveTool(command);
    let args = {};
    if (values.args) {
      try {
        args = JSON.parse(values.args);
      } catch {
        throw new Error("--args must be valid JSON");
      }
    }
    const result = await api(`/api/tools/${tool.id}/try`, {
      method: "POST",
      body: JSON.stringify({
        args,
        ...(tool.sideEffect === "write" ? { idempotencyKey: randomUUID() } : {}),
      }),
    });
    out(JSON_OUT ? result : JSON.stringify(result.data, null, 2));
    return;
  }

  if (group === "logs") {
    const params = new URLSearchParams();
    params.set("limit", values.limit ?? "20");
    if (values.app) params.set("sourceId", (await resolveApp(values.app)).source.id);
    if (values.status) params.set("status", values.status);
    if (values.actor) params.set("actorType", values.actor);
    const page = await api(`/api/invocations?${params.toString()}`);
    if (JSON_OUT) return out(page);
    out(
      table(page.invocations, [
        { key: "ts", label: "time" },
        { key: "toolName", label: "tool" },
        { key: "status", label: "status" },
        { key: "via", label: "via" },
        { key: "actorType", label: "actor" },
        { key: "latencyMs", label: "ms" },
      ]),
    );
    return;
  }

  if (group === "login") {
    await login();
    out(`logged in to ${BASE}`);
    return;
  }

  throw new Error(`Unknown command: ${QUERY.join(" ")}\n\n${HELP}`);
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
