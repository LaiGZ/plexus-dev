import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "../config.js";
import { changePassword, login, logout } from "../domain/auth/service.js";
import { requireAuth, SESSION_COOKIE } from "../http/auth.js";
import { requestMeta } from "../http/middleware.js";
import { readJson } from "../http/validate.js";
import type { AppEnv } from "../types.js";

const LoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(10).max(256),
});

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const body = await readJson(c, LoginSchema);
  const result = await login(body.username, body.password, requestMeta(c));

  setCookie(c, SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });

  return c.json({ user: result.user, expiresAt: result.expiresAt.toISOString() });
});

authRoutes.post("/logout", (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) logout(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

authRoutes.get("/me", (c) => {
  const user = requireAuth(c);
  return c.json({ user });
});

authRoutes.post("/password", async (c) => {
  const user = requireAuth(c);
  const body = await readJson(c, ChangePasswordSchema);
  const token = getCookie(c, SESSION_COOKIE) ?? "";
  await changePassword(user.id, body.currentPassword, body.newPassword, token);
  return c.body(null, 204);
});
