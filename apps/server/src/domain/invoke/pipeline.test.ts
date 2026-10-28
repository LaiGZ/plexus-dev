import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infra/db/client.js";
import { sources, tools } from "../../infra/db/schema.js";
import { runMigrations } from "../../infra/db/migrate.js";
import { listInvocations } from "../invocations/service.js";
import { invokeTool } from "./pipeline.js";
import { resetRateLimits } from "./rate-limit.js";

let server: Server;
let baseUrl: string;
let counter = 0;

beforeAll(async () => {
  await runMigrations();
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (req.url?.startsWith("/echo")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ received: body ? JSON.parse(body) : null, method: req.method }));
        return;
      }
      if (req.url?.startsWith("/count")) {
        counter += 1;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ hits: counter }));
        return;
      }
      if (req.url?.startsWith("/fail")) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "boom" }));
        return;
      }
      if (req.url?.startsWith("/redirect")) {
        res.statusCode = 302;
        res.setHeader("location", "/echo");
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetRateLimits();
  counter = 0;
});

async function createTool(overrides: {
  sideEffect?: "read" | "write";
  exposed?: boolean;
  path?: string;
  inputSchema?: unknown;
} = {}) {
  const sourceId = randomUUID();
  const slug = `t${sourceId.slice(0, 8)}`;
  await db.insert(sources).values({
    id: sourceId,
    name: "Test API",
    slug,
    kind: "http",
    baseUrl,
    authType: "none",
    headers: "{}",
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const toolId = randomUUID();
  await db.insert(tools).values({
    id: toolId,
    sourceId,
    name: "echo",
    mcpName: `${slug}__echo`,
    description: "Echo back what you send",
    inputSchema: JSON.stringify(
      overrides.inputSchema ?? {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    ),
    method: "POST",
    path: overrides.path ?? "/echo",
    sideEffect: overrides.sideEffect ?? "read",
    idempotent: false,
    exposed: overrides.exposed ?? true,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return toolId;
}

describe("invokeTool", () => {
  it("calls the upstream and returns parsed JSON", async () => {
    const toolId = await createTool();
    const result = await invokeTool({
      toolId,
      args: { message: "hello" },
      via: "try",
      scope: "read",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ received: { message: "hello" }, method: "POST" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("enforces the input schema", async () => {
    const toolId = await createTool();
    await expect(
      invokeTool({ toolId, args: { message: 42 }, via: "try", scope: "read" }),
    ).rejects.toMatchObject({ code: "invalid_args" });
  });

  it("rejects a read-only token for a write tool", async () => {
    const toolId = await createTool({ sideEffect: "write" });
    await expect(
      invokeTool({
        toolId,
        args: { message: "x" },
        via: "mcp",
        scope: "read",
        tokenId: "token-1",
        idempotencyKey: "key-12345678",
      }),
    ).rejects.toMatchObject({ code: "read_only_token" });
  });

  it("requires an idempotency key for write tools", async () => {
    const toolId = await createTool({ sideEffect: "write" });
    await expect(
      invokeTool({ toolId, args: { message: "x" }, via: "mcp", scope: "write", tokenId: "t" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("replays an idempotent write instead of calling the upstream twice", async () => {
    const toolId = await createTool({ sideEffect: "write", path: "/count" });
    const key = "retry-key-0001";

    const first = await invokeTool({
      toolId,
      args: { message: "once" },
      via: "mcp",
      scope: "write",
      tokenId: "token-2",
      idempotencyKey: key,
    });
    expect(first.data).toEqual({ hits: 1 });

    const second = await invokeTool({
      toolId,
      args: { message: "once" },
      via: "mcp",
      scope: "write",
      tokenId: "token-2",
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.data).toEqual({ hits: 1 });
    expect(counter).toBe(1);
  });

  it("maps an upstream 500 to upstream_error", async () => {
    const toolId = await createTool({ path: "/fail" });
    await expect(
      invokeTool({ toolId, args: { message: "x" }, via: "try", scope: "read" }),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("refuses to follow redirects", async () => {
    const toolId = await createTool({ path: "/redirect" });
    await expect(
      invokeTool({ toolId, args: { message: "x" }, via: "try", scope: "read" }),
    ).rejects.toMatchObject({ code: "upstream_redirect" });
  });

  it("hides a tool that is not exposed unless the caller may bypass", async () => {
    const toolId = await createTool({ exposed: false });
    await expect(
      invokeTool({ toolId, args: { message: "x" }, via: "mcp", scope: "read" }),
    ).rejects.toMatchObject({ code: "tool_not_exposed" });

    const allowed = await invokeTool({
      toolId,
      args: { message: "x" },
      via: "try",
      scope: "read",
      allowUnexposed: true,
    });
    expect(allowed.ok).toBe(true);
  });

  it("records one invocation per call, including failures", async () => {
    const okTool = await createTool();
    await invokeTool({ toolId: okTool, args: { message: "a" }, via: "try", scope: "read" });

    const failTool = await createTool({ path: "/fail" });
    await expect(
      invokeTool({ toolId: failTool, args: { message: "b" }, via: "try", scope: "read" }),
    ).rejects.toBeTruthy();

    const okPage = await listInvocations({ limit: 50, toolId: okTool });
    expect(okPage.invocations).toHaveLength(1);
    expect(okPage.invocations[0]?.status).toBe("ok");

    const failPage = await listInvocations({ limit: 50, toolId: failTool });
    expect(failPage.invocations).toHaveLength(1);
    expect(failPage.invocations[0]?.status).toBe("error");
    expect(failPage.invocations[0]?.errorCode).toBe("upstream_error");
  });
});
