import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { runMigrations } from "../infra/db/migrate.js";
import { listSources } from "../domain/source/service.js";

const TOKEN = "test-admin-token-123456";

let httpServer: ReturnType<typeof serve>;
let baseUrl: string;

beforeAll(async () => {
  await runMigrations();
  httpServer = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function connect(token = TOKEN): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/admin/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "admin-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: unknown = {}) {
  const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content[0]?.text ?? "";
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { isError: Boolean(result.isError), json };
}

const TEMPLATE = `
format: plexus.template.v1
app:
  name: Admin App
  baseUrl: http://127.0.0.1:7100
tools:
  - name: ping
    method: GET
    path: /health
    sideEffect: read
    exposed: true
  - name: make
    method: POST
    path: /make
    sideEffect: write
    exposed: true
    inputSchema:
      type: object
      properties:
        amount: { type: number }
`;

describe("admin MCP", () => {
  it("rejects requests without the admin token", async () => {
    const res = await fetch(`${baseUrl}/admin/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("lists management tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("create_app");
    expect(names).toContain("add_tool");
    expect(names).toContain("delete_tool");
    await client.close();
  });

  it("creates an app from a template and adds a method", async () => {
    const client = await connect();

    const created = await call(client, "create_app", { template: TEMPLATE });
    expect(created.isError).toBe(false);
    const createdBody = created.json as { appId: string; tools: Array<{ mcpName: string }> };
    expect(createdBody.tools.map((tool) => tool.mcpName)).toEqual([
      "admin-app__ping",
      "admin-app__make",
    ]);

    const added = await call(client, "add_tool", {
      app: "Admin App",
      name: "extra",
      method: "POST",
      path: "/extra",
      sideEffect: "write",
      exposed: true,
    });
    expect(added.isError).toBe(false);
    expect((added.json as { tool: { mcpName: string } }).tool.mcpName).toBe("admin-app__extra");

    const apps = await listSources();
    expect(apps.find((entry) => entry.id === createdBody.appId)?.toolCount).toBe(3);

    await client.close();
  });

  it("previews a delete and only deletes with confirm", async () => {
    const client = await connect();

    const preview = await call(client, "delete_tool", { tool: "admin-app.extra" });
    expect(preview.isError).toBe(false);
    const previewBody = preview.json as { deleted: boolean; usage: { exposed: boolean } };
    expect(previewBody.deleted).toBe(false);
    expect(previewBody.usage.exposed).toBe(true);

    const applied = await call(client, "delete_tool", { tool: "admin-app.extra", confirm: true });
    expect(applied.isError).toBe(false);
    expect((applied.json as { deleted: boolean }).deleted).toBe(true);

    const missing = await call(client, "get_app", { app: "Admin App" });
    const tools = (missing.json as { tools: Array<{ name: string }> }).tools;
    expect(tools.some((tool) => tool.name === "extra")).toBe(false);

    await client.close();
  });

  it("exports and re-imports without changes", async () => {
    const client = await connect();

    const exported = await call(client, "export_app", { app: "Admin App" });
    const payload = exported.json as { format: string; tools: unknown[] };
    expect(payload.format).toBe("plexus.app.v1");

    const preview = await call(client, "import_app", {
      app: "Admin App",
      config: JSON.stringify(payload),
    });
    expect(preview.isError).toBe(false);
    const body = preview.json as {
      applied: boolean;
      diff: { added: unknown[]; updated: unknown[]; removed: unknown[] };
    };
    expect(body.applied).toBe(false);
    expect(body.diff.added).toHaveLength(0);
    expect(body.diff.updated).toHaveLength(0);
    expect(body.diff.removed).toHaveLength(0);

    await client.close();
  });
});
