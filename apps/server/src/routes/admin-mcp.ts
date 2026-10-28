import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { config } from "../config.js";
import { handleAdminMcpRequest } from "../mcp/admin.js";

function tokenMatches(raw: string): boolean {
  if (!config.adminMcpToken) return false;
  const left = createHash("sha256").update(raw).digest();
  const right = createHash("sha256").update(config.adminMcpToken).digest();
  return timingSafeEqual(left, right);
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <ADMIN_MCP_TOKEN>" },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="plexus-admin"',
      },
    },
  );
}

export const adminMcpRoutes = new Hono();

adminMcpRoutes.post("/", async (c) => {
  if (!config.adminMcpToken) {
    return c.json(
      { error: "Admin MCP is disabled. Set ADMIN_MCP_TOKEN to enable /admin/mcp." },
      404,
    );
  }

  const raw = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw || !tokenMatches(raw)) return unauthorized();

  return handleAdminMcpRequest(c.req.raw);
});

adminMcpRoutes.get("/", (c) => {
  c.header("allow", "POST");
  return c.json({ error: "Method Not Allowed: use POST /admin/mcp" }, 405);
});
