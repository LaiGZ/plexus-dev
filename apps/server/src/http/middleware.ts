import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { config } from "../config.js";
import { logger } from "../infra/logger.js";
import type { AppEnv } from "../types.js";

/** Request id + structured access log. One trace id per request, honored upstream. */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header("x-request-id")?.slice(0, 64) || randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  const started = performance.now();
  await next();
  const durationMs = Math.round(performance.now() - started);

  const path = c.req.path;
  if (path.startsWith("/assets/") || path === "/favicon.ico") return;

  logger.info(
    {
      requestId,
      method: c.req.method,
      path,
      status: c.res.status,
      durationMs,
      userId: c.get("auth")?.id,
    },
    "request",
  );
};

/**
 * CSRF defense in depth: session cookies are SameSite=Lax, and every mutating
 * request must carry a custom header that a cross-site form cannot set.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  const hasSessionCookie = (c.req.header("cookie") ?? "").includes("px_session=");
  if (!hasSessionCookie) return next();

  if (c.req.header("x-requested-with") !== "plexus") {
    return c.json(
      {
        error: {
          code: "forbidden",
          message: "Missing CSRF header",
          hint: "Mutating requests must send x-requested-with: plexus",
          requestId: c.get("requestId"),
        },
      },
      403,
    );
  }
  return next();
};

export function requestMeta(c: Context<AppEnv>) {
  return {
    ip: config.trustProxy
      ? (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null)
      : null,
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  };
}
