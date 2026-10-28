import { beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { runMigrations } from "./infra/db/migrate.js";
import { seed } from "./infra/db/seed.js";

const CREDENTIALS = { username: "plexus", password: "test-password-123" };

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "plexus",
      ...headers,
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

beforeAll(async () => {
  await runMigrations();
  await seed();
});

describe("health", () => {
  it("reports database connectivity", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
  });
});

describe("auth", () => {
  it("rejects anonymous access to protected endpoints", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects a wrong password without leaking which field failed", async () => {
    const res = await post("/api/auth/login", { username: "plexus", password: "nope" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Invalid username or password");
  });

  it("logs in and returns the session user", async () => {
    const res = await post("/api/auth/login", CREDENTIALS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { username: string; role: { key: string } } };
    expect(body.user.username).toBe("plexus");
    expect(body.user.role.key).toBe("super_admin");

    const me = await app.request("/api/auth/me", { headers: { cookie: cookieFrom(res) } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { username: string } };
    expect(meBody.user.username).toBe("plexus");
  });

  it("requires the CSRF header on mutating requests that carry a session", async () => {
    const login = await post("/api/auth/login", CREDENTIALS);
    const cookie = cookieFrom(login);

    const blocked = await app.request("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword: "x", newPassword: "y".repeat(12) }),
    });
    expect(blocked.status).toBe(403);

    const allowed = await post(
      "/api/auth/password",
      { currentPassword: CREDENTIALS.password, newPassword: "a-new-password-123" },
      { cookie },
    );
    expect(allowed.status).toBe(204);

    const relogin = await post("/api/auth/login", {
      username: "plexus",
      password: "a-new-password-123",
    });
    expect(relogin.status).toBe(200);
  });
});
