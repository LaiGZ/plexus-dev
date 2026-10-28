import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { runMigrations } from "../infra/db/migrate.js";
import { createToken } from "../domain/tokens/service.js";
import { createSource } from "../domain/source/service.js";
import { updateTool } from "../domain/source/service.js";

let httpServer: ReturnType<typeof serve>;
let baseUrl: string;
let readToken: string;
let writeToken: string;
let readToolName: string;
let writeToolName: string;
let calls = 0;

beforeAll(async () => {
  await runMigrations();

  const upstream = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/count")) {
        calls += 1;
        res.end(JSON.stringify({ hits: calls }));
        return;
      }
      res.end(JSON.stringify({ echo: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;

  const created = await createSource({
    name: "MCP Test",
    kind: "http",
    baseUrl: `http://127.0.0.1:${upstreamPort}`,
    auth: { type: "none" },
    headers: {},
    tools: [
      {
        name: "echo",
        description: "Echo a message",
        method: "POST",
        path: "/echo",
        sideEffect: "read",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
      },
      {
        name: "bump",
        description: "Increment a counter",
        method: "POST",
        path: "/count",
        sideEffect: "write",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  });

  for (const tool of created.tools) {
    await updateTool(tool.id, { exposed: true });
    if (tool.name === "echo") readToolName = tool.mcpName;
    if (tool.name === "bump") writeToolName = tool.mcpName;
  }

  readToken = (await createToken({ name: "read", scope: "read" })).token;
  writeToken = (await createToken({ name: "write", scope: "write" })).token;

  httpServer = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "plexus-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("MCP endpoint", () => {
  it("rejects requests without a token", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("only lists read tools for a read token", async () => {
    const client = await connect(readToken);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([readToolName]);
    await client.close();
  });

  it("lists every exposed tool for a write token", async () => {
    const client = await connect(writeToken);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([readToolName, writeToolName].sort());
    const read = tools.find((t) => t.name === readToolName);
    expect(read?.annotations?.readOnlyHint).toBe(true);
    await client.close();
  });

  it("calls a read tool and returns the upstream payload", async () => {
    const client = await connect(readToken);
    const result = await client.callTool({
      name: readToolName,
      arguments: { message: "hi" },
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain('"hi"');
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("derives an idempotency key so a retried write runs once", async () => {
    const client = await connect(writeToken);
    const first = await client.callTool({ name: writeToolName, arguments: {} });
    const second = await client.callTool({ name: writeToolName, arguments: {} });

    const textOf = (r: typeof first) =>
      (r.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(textOf(first)).toContain('"hits":1');
    expect(textOf(second)).toContain('"hits":1');
    await client.close();
  });
});
