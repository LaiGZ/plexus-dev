import { describe, expect, it } from "vitest";
import { runMigrations } from "../../infra/db/migrate.js";
import {
  addTool,
  applyImport,
  createSource,
  deleteSource,
  deleteTool,
  getSource,
  getToolUsage,
  getAppGrants,
  listSources,
  listTools,
  mcpNameFor,
  previewImport,
  setAppGrants,
  slugify,
  updateSource,
  updateTool,
} from "./service.js";

await runMigrations();

describe("naming", () => {
  it("slugifies source names", () => {
    expect(slugify("My Todo API")).toBe("my-todo-api");
    expect(slugify("  ???  ")).toBe("source");
  });

  it("keeps MCP names unique and bounded", () => {
    const taken = new Set<string>();
    const first = mcpNameFor("todo", "list", taken);
    const second = mcpNameFor("todo", "list", taken);
    expect(first).toBe("todo__list");
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(64);
  });
});

describe("source lifecycle", () => {
  it("creates, reads, updates and deletes a source", async () => {
    const created = await createSource({
      name: "Lifecycle API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [
        {
          name: "ping",
          description: "Ping",
          method: "GET",
          path: "/ping",
          sideEffect: "read",
        },
      ],
    });

    expect(created.source.slug).toBe("lifecycle-api");
    expect(created.tools[0]?.mcpName).toBe("lifecycle-api__ping");
    expect(created.tools[0]?.exposed).toBe(false);

    const detail = await getSource(created.source.id);
    expect(detail.tools).toHaveLength(1);
    expect(detail.source.toolCount).toBe(1);

    const exposed = await updateTool(created.tools[0]!.id, { exposed: true });
    expect(exposed.exposed).toBe(true);

    const renamed = await updateSource(created.source.id, { name: "Renamed API", enabled: false });
    expect(renamed.name).toBe("Renamed API");
    expect(renamed.slug).toBe("lifecycle-api");
    expect(renamed.enabled).toBe(false);

    const listed = await listSources();
    expect(listed.find((s) => s.id === created.source.id)?.exposedCount).toBe(1);

    await deleteSource(created.source.id);
    expect((await listTools()).some((t) => t.sourceId === created.source.id)).toBe(false);
  });

  it("can expose every method at creation time", async () => {
    const created = await createSource({
      name: "Exposed API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      exposeAll: true,
      tools: [
        { name: "list", description: "", method: "GET", path: "/a", sideEffect: "read" },
        { name: "create", description: "", method: "POST", path: "/b", sideEffect: "write" },
      ],
    });

    expect(created.tools).toHaveLength(2);
    expect(created.tools.every((tool) => tool.exposed)).toBe(true);
    expect(created.source.exposedCount).toBe(2);
  });

  it("edits a tool and keeps its MCP name in sync", async () => {
    const created = await createSource({
      name: "Edit API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "alpha", description: "A", method: "GET", path: "/a", sideEffect: "read" }],
    });

    const updated = await updateTool(created.tools[0]!.id, {
      name: "beta",
      method: "PUT",
      path: "/beta/{id}",
      description: "B",
      sideEffect: "write",
    });

    expect(updated.name).toBe("beta");
    expect(updated.mcpName).toBe("edit-api__beta");
    expect(updated.displayName).toBe("edit-api.beta");
    expect(updated.method).toBe("PUT");
    expect(updated.path).toBe("/beta/{id}");
    expect(updated.sideEffect).toBe("write");
  });

  it("refuses to rename a remote MCP tool", async () => {
    const created = await createSource({
      name: "Remote",
      kind: "mcp",
      baseUrl: "http://127.0.0.1:9/mcp",
      auth: { type: "none" },
      headers: {},
      tools: [
        { name: "remoteEcho", description: "", method: "POST", path: "/", sideEffect: "read" },
      ],
    });

    await expect(
      updateTool(created.tools[0]!.id, { name: "renamed" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("adds a method to an existing app", async () => {
    const created = await createSource({
      name: "Add API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "alpha", description: "", method: "GET", path: "/a", sideEffect: "read" }],
    });

    const added = await addTool(created.source.id, {
      name: "gamma",
      method: "GET",
      path: "/g",
      description: "G",
      sideEffect: "read",
      exposed: true,
      enabled: true,
    });
    expect(added.displayName).toBe("add-api.gamma");
    expect(added.mcpName).toBe("add-api__gamma");

    await expect(
      addTool(created.source.id, {
        name: "gamma",
        method: "GET",
        path: "/g2",
        description: "",
        sideEffect: "read",
        exposed: false,
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("previews and applies an exported configuration", async () => {
    const created = await createSource({
      name: "Import API",
      kind: "http",
      baseUrl: "https://old.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [
        { name: "alpha", description: "A", method: "GET", path: "/a", sideEffect: "read" },
        { name: "beta", description: "B", method: "GET", path: "/b", sideEffect: "read" },
      ],
    });

    const file = JSON.stringify({
      format: "plexus.app.v1",
      app: {
        id: created.source.id,
        name: "Renamed API",
        kind: "http",
        baseUrl: "https://new.example.com",
      },
      tools: [
        {
          name: "alpha",
          description: "changed",
          method: "POST",
          path: "/a2",
          sideEffect: "write",
          inputSchema: { type: "object", properties: {} },
          exposed: true,
          enabled: true,
        },
        {
          name: "delta",
          description: "new",
          method: "GET",
          path: "/d",
          sideEffect: "read",
          inputSchema: { type: "object", properties: {} },
          exposed: true,
          enabled: true,
        },
      ],
    });

    const diff = await previewImport(created.source.id, file);
    expect(diff.nameChange).toEqual({ from: "Import API", to: "Renamed API" });
    expect(diff.baseUrlChange).toEqual({
      from: "https://old.example.com",
      to: "https://new.example.com",
    });
    expect(diff.added.map((tool) => tool.name)).toEqual(["delta"]);
    expect(diff.updated.map((tool) => tool.name)).toEqual(["alpha"]);
    expect(diff.updated[0]?.fields).toEqual(
      expect.arrayContaining(["description", "method", "path", "sideEffect", "exposed"]),
    );
    expect(diff.removed.map((tool) => tool.name)).toEqual(["beta"]);

    const result = await applyImport(created.source.id, file, true);
    expect(result).toEqual({ created: 1, updated: 1, removed: 1 });

    const detail = await getSource(created.source.id);
    expect(detail.source.name).toBe("Renamed API");
    expect(detail.source.baseUrl).toBe("https://new.example.com");
    expect(detail.tools.map((tool) => tool.name).sort()).toEqual(["alpha", "delta"]);
    const alpha = detail.tools.find((tool) => tool.name === "alpha");
    expect(alpha?.sideEffect).toBe("write");
    expect(alpha?.path).toBe("/a2");
  });

  it("rejects an export whose app_id does not match", async () => {
    const created = await createSource({
      name: "Own API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "a", description: "", method: "GET", path: "/a", sideEffect: "read" }],
    });

    const file = JSON.stringify({
      format: "plexus.app.v1",
      app: { id: "someone-else", name: "X", kind: "http", baseUrl: "https://x.example.com" },
      tools: [{ name: "a", method: "GET", path: "/a", sideEffect: "read" }],
    });

    await expect(previewImport(created.source.id, file)).rejects.toMatchObject({
      code: "invalid_request",
      message: "app_id_mismatch",
    });
  });

  it("rejects malformed export files", async () => {
    const created = await createSource({
      name: "Strict API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "a", description: "", method: "GET", path: "/a", sideEffect: "read" }],
    });

    await expect(previewImport(created.source.id, "{}")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(previewImport(created.source.id, "not json")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("reports and cleans up references when a method is deleted", async () => {
    const target = await createSource({
      name: "Target API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      exposeAll: true,
      tools: [{ name: "doIt", description: "", method: "POST", path: "/do", sideEffect: "write" }],
    });
    const caller = await createSource({
      name: "Caller API",
      kind: "http",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "ping", description: "", method: "GET", path: "/ping", sideEffect: "read" }],
    });

    const tool = target.tools[0]!;
    await setAppGrants(caller.source.id, [tool.id]);

    const usage = await getToolUsage(tool.id);
    expect(usage.exposed).toBe(true);
    expect(usage.grantedApps).toEqual([{ id: caller.source.id, name: "Caller API" }]);

    await deleteTool(tool.id);
    expect((await getSource(target.source.id)).tools).toHaveLength(0);
    expect(await getAppGrants(caller.source.id)).toEqual([]);
  });

  it("rejects duplicate tool names inside one source", async () => {
    await expect(
      createSource({
        name: "Dup API",
        kind: "http",
        baseUrl: "https://api.example.com",
        auth: { type: "none" },
        headers: {},
        tools: [
          { name: "same", description: "", method: "GET", path: "/a", sideEffect: "read" },
          { name: "same", description: "", method: "GET", path: "/b", sideEffect: "read" },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("de-duplicates slugs when names collide", async () => {
    const first = await createSource({
      name: "Same Name",
      kind: "http",
      baseUrl: "https://a.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "a", description: "", method: "GET", path: "/a", sideEffect: "read" }],
    });
    const second = await createSource({
      name: "Same Name",
      kind: "http",
      baseUrl: "https://b.example.com",
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "b", description: "", method: "GET", path: "/b", sideEffect: "read" }],
    });
    expect(first.source.slug).not.toBe(second.source.slug);
  });
});
