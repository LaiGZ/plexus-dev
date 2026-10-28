import { serve } from "@hono/node-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../infra/db/migrate.js";
import { invokeTool } from "../invoke/pipeline.js";
import { previewSource } from "./preview.js";
import { createSource, updateTool } from "./service.js";

const remote = new Hono();
let hits = 0;

remote.post("/mcp", async (c) => {
  const server = new Server(
    { name: "remote-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "remoteEcho",
        description: "Echo text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: "remoteBump",
        description: "Increment a counter",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    if (request.params.name === "remoteEcho") {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ echo: args["text"] ?? null }) }],
      };
    }
    if (request.params.name === "remoteBump") {
      hits += 1;
      return { content: [{ type: "text" as const, text: JSON.stringify({ hits }) }] };
    }
    return { content: [{ type: "text" as const, text: "unknown tool" }], isError: true };
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});

let httpServer: ReturnType<typeof serve>;
let baseUrl: string;

beforeAll(async () => {
  await runMigrations();
  httpServer = serve({ fetch: remote.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("remote MCP sources", () => {
  it("discovers remote tools and turns them into drafts", async () => {
    const preview = await previewSource({
      kind: "mcp",
      name: "Remote",
      baseUrl,
      auth: { type: "none" },
      headers: {},
    });

    expect(preview.baseUrl).toBe(baseUrl);
    expect(preview.tools.map((tool) => tool.name).sort()).toEqual([
      "remoteBump",
      "remoteEcho",
    ]);
    expect(preview.tools.find((tool) => tool.name === "remoteEcho")?.sideEffect).toBe("read");
    // No readOnlyHint → treated as a write.
    expect(preview.tools.find((tool) => tool.name === "remoteBump")?.sideEffect).toBe("write");
  });

  it("proxies reads and writes through the gateway", async () => {
    const preview = await previewSource({
      kind: "mcp",
      name: "Remote",
      baseUrl,
      auth: { type: "none" },
      headers: {},
    });

    const created = await createSource({
      name: "Remote",
      kind: "mcp",
      baseUrl,
      auth: { type: "none" },
      headers: {},
      exposeAll: true,
      tools: preview.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        sideEffect: tool.sideEffect,
        inputSchema: tool.inputSchema,
      })),
    });

    const echo = created.tools.find((tool) => tool.name === "remoteEcho")!;
    const bump = created.tools.find((tool) => tool.name === "remoteBump")!;

    const read = await invokeTool({
      toolId: echo.id,
      args: { text: "hello" },
      via: "mcp",
      scope: "read",
      tokenId: "t1",
    });
    expect(read.data).toEqual({ echo: "hello" });

    await expect(
      invokeTool({
        toolId: bump.id,
        args: {},
        via: "mcp",
        scope: "read",
        tokenId: "t1",
      }),
    ).rejects.toMatchObject({ code: "read_only_token" });

    const before = hits;
    const write = await invokeTool({
      toolId: bump.id,
      args: {},
      via: "mcp",
      scope: "write",
      tokenId: "t2",
      idempotencyKey: "remote-bump-1",
    });
    expect(write.data).toEqual({ hits: before + 1 });

    const replay = await invokeTool({
      toolId: bump.id,
      args: {},
      via: "mcp",
      scope: "write",
      tokenId: "t2",
      idempotencyKey: "remote-bump-1",
    });
    expect(replay.replayed).toBe(true);
    expect(hits).toBe(before + 1);

    // Keep the summary list tidy for later tests in this file.
    await updateTool(echo.id, { exposed: false });
    await updateTool(bump.id, { exposed: false });
  });
});
