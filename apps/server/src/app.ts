import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "./config.js";
import { isAppError } from "./infra/errors.js";
import { logger } from "./infra/logger.js";
import { attachAuth } from "./http/auth.js";
import { csrfGuard, requestContext } from "./http/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { adminMcpRoutes } from "./routes/admin-mcp.js";
import { agentRoutes } from "./routes/agent.js";
import { gatewayRoutes } from "./routes/gateway.js";
import { healthRoutes } from "./routes/health.js";
import { invocationRoutes } from "./routes/invocations.js";
import { metaRoutes } from "./routes/meta.js";
import { mcpRoutes } from "./routes/mcp.js";
import { sourceRoutes } from "./routes/sources.js";
import { statsRoutes } from "./routes/stats.js";
import { templateRoutes } from "./routes/templates.js";
import { tokenRoutes } from "./routes/tokens.js";
import { toolRoutes } from "./routes/tools.js";
import type { AppEnv } from "./types.js";

export const app = new Hono<AppEnv>();

app.use("*", requestContext);
app.use("*", attachAuth);
app.use("/api/*", csrfGuard);

app.route("/api/auth", authRoutes);
app.route("/api/agent", agentRoutes);
app.route("/api/gateway", gatewayRoutes);
app.route("/api", metaRoutes);
app.route("/api/sources", sourceRoutes);
app.route("/api/templates", templateRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/tokens", tokenRoutes);
app.route("/api/tools", toolRoutes);
app.route("/api/invocations", invocationRoutes);
app.route("/mcp", mcpRoutes);
app.route("/admin/mcp", adminMcpRoutes);
app.route("/", healthRoutes);

const RESERVED_PREFIXES = ["/api/", "/mcp", "/healthz"];

if (config.webDist) {
  const root = relative(process.cwd(), config.webDist) || ".";
  const indexHtml = readFileSync(join(config.webDist, "index.html"), "utf8");

  app.use("/*", serveStatic({ root }));

  app.notFound((c) => {
    if (RESERVED_PREFIXES.some((p) => c.req.path.startsWith(p))) {
      return c.json(
        {
          error: { code: "not_found", message: "Endpoint not found", requestId: c.get("requestId") },
        },
        404,
      );
    }
    return c.html(indexHtml);
  });
} else {
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: "Endpoint not found (web build missing)",
          requestId: c.get("requestId"),
        },
      },
      404,
    ),
  );
}

app.onError((err, c) => {
  const requestId = c.get("requestId");

  if (isAppError(err)) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.hint ? { hint: err.hint } : {}),
          ...(err.details ? { details: err.details } : {}),
          requestId,
        },
      },
      err.status as ContentfulStatusCode,
    );
  }

  logger.error({ err, requestId, path: c.req.path }, "unhandled error");
  return c.json(
    { error: { code: "internal", message: "Internal server error", requestId } },
    500,
  );
});

export type AppType = typeof app;
