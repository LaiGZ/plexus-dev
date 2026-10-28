import { and, eq, lt, ne } from "drizzle-orm";
import { config } from "../../config.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../../infra/crypto.js";
import { AppError, rateLimited, unauthorized } from "../../infra/errors.js";
import { db } from "../../infra/db/client.js";
import { roles, sessions, users, type Role, type User } from "../../infra/db/schema.js";

export interface AuthUser {
  id: string;
  username: string;
  role: { key: string; name: string; permissions: string[] };
  mustChangePassword: boolean;
}

export interface LoginMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60_000;
/** In-memory by design: plexus is a single-process, single-user server. */
const attempts = new Map<string, { count: number; until: number }>();

function parsePermissions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function toAuthUser(user: User, role: Role): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: { key: role.key, name: role.name, permissions: parsePermissions(role.permissions) },
    mustChangePassword: user.mustChangePassword,
  };
}

function recordFail(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.until = now + LOCK_MS;
  attempts.set(key, rec);
}

export async function login(
  username: string,
  password: string,
  meta: LoginMeta = {},
): Promise<{ token: string; expiresAt: Date; user: AuthUser }> {
  const key = `${meta.ip ?? "-"}:${username.toLowerCase()}`;
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.until > now) throw rateLimited();

  const user = (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];
  if (!user || user.status !== "active") {
    recordFail(key);
    throw unauthorized("Invalid username or password");
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    recordFail(key);
    throw unauthorized("Invalid username or password");
  }
  attempts.delete(key);

  const role = (await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1))[0];
  if (!role) throw unauthorized("Account has no role assigned");

  const nowDate = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, nowDate));

  const token = randomToken(32);
  const expiresAt = new Date(nowDate.getTime() + config.sessionTtlMs);
  await db.insert(sessions).values({
    id: sha256(token),
    userId: user.id,
    createdAt: nowDate,
    lastSeenAt: nowDate,
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  await db.update(users).set({ lastLoginAt: nowDate }).where(eq(users.id, user.id));

  return { token, expiresAt, user: toAuthUser(user, role) };
}

export async function resolveSession(token: string): Promise<AuthUser | null> {
  const id = sha256(token);
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)).limit(1))[0];
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  const user = (await db.select().from(users).where(eq(users.id, session.userId)).limit(1))[0];
  if (!user || user.status !== "active") return null;
  const role = (await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1))[0];
  if (!role) return null;

  // Throttled lastSeenAt write: at most once per minute.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }

  return toAuthUser(user, role);
}

export async function logout(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentToken: string,
): Promise<void> {
  if (newPassword.length < 10) {
    throw new AppError(
      "password_policy",
      400,
      "New password must be at least 10 characters",
    );
  }
  if (newPassword === currentPassword) {
    throw new AppError(
      "password_policy",
      400,
      "New password must differ from the current one",
    );
  }

  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) throw unauthorized();
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError("invalid_password", 400, "Current password is incorrect");
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false })
    .where(eq(users.id, userId));

  // Revoke every other session; keep the current one alive.
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, sha256(currentToken))));
}
