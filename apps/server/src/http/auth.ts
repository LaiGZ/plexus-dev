import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { resolveSession } from "../domain/auth/service.js";
import { unauthorized } from "../infra/errors.js";
import type { AuthUser } from "../domain/auth/service.js";
import type { AppEnv } from "../types.js";

export const SESSION_COOKIE = "px_session";

/** Resolve the session for every request; never rejects on its own. */
export const attachAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set("auth", token ? await resolveSession(token) : null);
  await next();
};

export function requireAuth(c: Context<AppEnv>): AuthUser {
  const user = c.get("auth");
  if (!user) throw unauthorized();
  return user;
}
