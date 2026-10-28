import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { runMigrations } from "../../infra/db/migrate.js";
import { listInvocations } from "../invocations/service.js";
import { createSource, setAppGrants } from "../source/service.js";
import { exchangeAppSecret, issueAppSecret } from "./app-auth.js";

let upstream: ReturnType<typeof createServer>;
let upstreamUrl: string;
let hits = 0;

beforeAll(async () => {
  await runMigrations();

  upstream = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/count")) {
      hits += 1;
      res.end(JSON.stringify({ hits }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

async function invoke(token: string, body: unknown) {
  return app.request("/api/gateway/invoke", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe("application credentials", () => {
  it("issues a secret, exchanges it for a service token and calls a tool", async () => {
    const created = await createSource({
      name: "Caller App",
      kind: "http",
      baseUrl: upstreamUrl,
      auth: { type: "none" },
      headers: {},
      exposeAll: true,
      tools: [
        { name: "bump", description: "count", method: "POST", path: "/count", sideEffect: "write" },
      ],
    });

    const { secret, prefix } = await issueAppSecret(created.source.id);
    expect(secret.startsWith("pxa_")).toBe(true);
    expect(prefix).toBe(secret.slice(0, 10));

    await expect(exchangeAppSecret(created.source.id, "wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });

    const { accessToken, expiresIn } = await exchangeAppSecret(created.source.id, secret);
    expect(expiresIn).toBeGreaterThan(0);

    const before = hits;
    const res = await invoke(accessToken, { tool: created.tools[0]!.mcpName, args: {} });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { hits: number } };
    expect(body.data.hits).toBe(before + 1);

    // Identical call derives the same idempotency key → replay, no second upstream hit.
    const again = await invoke(accessToken, { tool: created.tools[0]!.mcpName, args: {} });
    const againBody = (await again.json()) as { replayed?: boolean; data: { hits: number } };
    expect(againBody.replayed).toBe(true);
    expect(hits).toBe(before + 1);

    const page = await listInvocations({ limit: 20 });
    const row = page.invocations.find((item) => item.toolId === created.tools[0]!.id);
    expect(row?.actorType).toBe("app");
    expect(row?.actorId).toBe(created.source.id);
    expect(row?.via).toBe("gateway-app");

    // Rotating the secret invalidates previously issued service tokens.
    await issueAppSecret(created.source.id);
    const stale = await invoke(accessToken, { tool: created.tools[0]!.mcpName, args: {} });
    expect(stale.status).toBe(401);
  });

  it("requires an explicit grant for cross-app calls", async () => {
    const caller = await createSource({
      name: "Caller B",
      kind: "http",
      baseUrl: upstreamUrl,
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "ping", description: "", method: "GET", path: "/health", sideEffect: "read" }],
    });
    const target = await createSource({
      name: "Target B",
      kind: "http",
      baseUrl: upstreamUrl,
      auth: { type: "none" },
      headers: {},
      exposeAll: true,
      tools: [{ name: "status", description: "", method: "GET", path: "/health", sideEffect: "read" }],
    });

    const { secret } = await issueAppSecret(caller.source.id);
    const { accessToken } = await exchangeAppSecret(caller.source.id, secret);
    const tool = target.tools[0]!.mcpName;

    const denied = await invoke(accessToken, { tool, args: {} });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { message: string } }).error.message).toBe("no_grant");

    await setAppGrants(caller.source.id, [target.tools[0]!.id]);
    const allowed = await invoke(accessToken, { tool, args: {} });
    expect(allowed.status).toBe(201);

    // The human-facing `app.tool` form is accepted too.
    const byDisplay = await invoke(accessToken, {
      tool: `${target.source.slug}.${target.tools[0]!.name}`,
      args: {},
    });
    expect(byDisplay.status).toBe(201);
  });

  it("rejects invalid tokens and unexposed tools", async () => {
    const bad = await invoke("nope", { tool: "anything", args: {} });
    expect(bad.status).toBe(401);

    const hidden = await createSource({
      name: "Hidden App",
      kind: "http",
      baseUrl: upstreamUrl,
      auth: { type: "none" },
      headers: {},
      tools: [{ name: "secret", description: "", method: "GET", path: "/x", sideEffect: "read" }],
    });
    const { secret } = await issueAppSecret(hidden.source.id);
    const { accessToken } = await exchangeAppSecret(hidden.source.id, secret);

    const res = await invoke(accessToken, { tool: hidden.tools[0]!.mcpName, args: {} });
    expect(res.status).toBe(404);
  });
});
