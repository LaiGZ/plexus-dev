import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { runMigrations } from "../infra/db/migrate.js";
import { createSource, updateTool } from "../domain/source/service.js";
import { createToken, listTokens } from "../domain/tokens/service.js";

let httpServer: ReturnType<typeof serve>;
let baseUrl: string;
let appA: string;
let appB: string;
let toolA: string;
let toolB: string;

beforeAll(async () => {
  await runMigrations();

  const upstream = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const first = await createSource({
    name: "App A",
    kind: "http",
    baseUrl: upstreamUrl,
    auth: { type: "none" },
    headers: {},
    tools: [{ name: "alpha", description: "A", method: "GET", path: "/a", sideEffect: "read" }],
  });
  const second = await createSource({
    name: "App B",
    kind: "http",
    baseUrl: upstreamUrl,
    auth: { type: "none" },
    headers: {},
    tools: [{ name: "beta", description: "B", method: "GET", path: "/b", sideEffect: "read" }],
  });

  appA = first.source.id;
  appB = second.source.id;
  toolA = first.tools[0]!.mcpName;
  toolB = second.tools[0]!.mcpName;
  await updateTool(first.tools[0]!.id, { exposed: true });
  await updateTool(second.tools[0]!.id, { exposed: true });

  httpServer = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function listToolNames(token: string): Promise<string[]> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "scope-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}

describe("token app scoping", () => {
  it("restricts a token to the selected apps", async () => {
    const { token, summary } = await createToken({
      name: "App A only",
      scope: "read",
      sourceIds: [appA],
    });
    expect(summary.sourceIds).toEqual([appA]);

    const names = await listToolNames(token);
    expect(names).toContain(toolA);
    expect(names).not.toContain(toolB);
  });

  it("allows every app when no restriction is set", async () => {
    const { token } = await createToken({ name: "Everything", scope: "read" });
    const names = await listToolNames(token);
    expect(names).toEqual([toolA, toolB].sort());
  });

  it("reports restrictions in the token list and clears them on revoke", async () => {
    const { token, summary } = await createToken({
      name: "Temporary",
      scope: "read",
      sourceIds: [appB],
    });

    const listed = await listTokens();
    expect(listed.find((row) => row.id === summary.id)?.sourceIds).toEqual([appB]);

    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "scope-test", version: "0.0.0" });
    await client.connect(transport);
    await client.close();
  });

  it("rejects unknown tokens", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer px_not_a_real_token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });
});
