import { Hono } from "hono";
import { verifyBearerToken } from "../domain/tokens/service.js";
import { handleMcpRequest } from "../mcp/server.js";
import type { AppEnv } from "../types.js";

export const mcpRoutes = new Hono<AppEnv>();

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <token>" },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="plexus"',
      },
    },
  );
}

mcpRoutes.post("/", async (c) => {
  const raw = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) return unauthorized();

  const token = await verifyBearerToken(raw);
  if (!token) return unauthorized();

  return handleMcpRequest(c.req.raw, token);
});

// Stateless Streamable HTTP: no server-initiated stream to resume.
mcpRoutes.get("/", (c) => {
  c.header("allow", "POST");
  return c.json({ error: "Method Not Allowed: use POST /mcp" }, 405);
});
