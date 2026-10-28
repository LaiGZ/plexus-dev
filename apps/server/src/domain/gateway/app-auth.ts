import { randomBytes } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { hashPassword, sha256, verifyPassword } from "../../infra/crypto.js";
import { db } from "../../infra/db/client.js";
import { serviceTokens, sources, tools } from "../../infra/db/schema.js";
import { notFound, unauthorized } from "../../infra/errors.js";

const TOKEN_TTL_MS = 3_600_000;

/** Issue (or rotate) the secret an app uses to obtain service tokens. */
export async function issueAppSecret(sourceId: string): Promise<{ secret: string; prefix: string }> {
  const row = (await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1))[0];
  if (!row) throw notFound("App not found");

  const secret = `pxa_${randomBytes(24).toString("base64url")}`;
  await db
    .update(sources)
    .set({
      appSecretHash: await hashPassword(secret),
      appSecretPrefix: secret.slice(0, 10),
      appSecretCreatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));

  // Rotating a secret invalidates tokens issued with the old one.
  await db.delete(serviceTokens).where(eq(serviceTokens.sourceId, sourceId));

  return { secret, prefix: secret.slice(0, 10) };
}

export async function exchangeAppSecret(
  appId: string,
  secret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const row = (await db.select().from(sources).where(eq(sources.id, appId)).limit(1))[0];
  if (!row?.appSecretHash || !row.enabled) throw unauthorized("invalid_client");
  if (!(await verifyPassword(secret, row.appSecretHash))) throw unauthorized("invalid_client");

  await db.delete(serviceTokens).where(lt(serviceTokens.expiresAt, new Date()));

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(serviceTokens).values({
    id: sha256(token),
    sourceId: appId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
  });

  return { accessToken: token, expiresIn: Math.floor(TOKEN_TTL_MS / 1000) };
}

export async function verifyServiceToken(
  raw: string,
): Promise<{ sourceId: string } | null> {
  const row = (await db.select().from(serviceTokens).where(eq(serviceTokens.id, sha256(raw))).limit(1))[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return { sourceId: row.sourceId };
}

/** Only exposed, enabled tools of enabled apps can be called. */
export async function findExposedTool(ref: string) {
  const base = and(
    eq(tools.exposed, true),
    eq(tools.enabled, true),
    eq(sources.enabled, true),
  );

  const row = (
    await db
      .select({ tool: tools })
      .from(tools)
      .innerJoin(sources, eq(tools.sourceId, sources.id))
      .where(and(base, or(eq(tools.id, ref), eq(tools.mcpName, ref))))
      .limit(1)
  )[0];
  if (row?.tool) return row.tool;

  // Accept the human-facing `app.tool` form as well.
  const dot = ref.indexOf(".");
  if (dot <= 0) return null;
  const slug = ref.slice(0, dot);
  const toolName = ref.slice(dot + 1);

  const byDisplay = (
    await db
      .select({ tool: tools })
      .from(tools)
      .innerJoin(sources, eq(tools.sourceId, sources.id))
      .where(and(base, eq(sources.slug, slug), eq(tools.name, toolName)))
      .limit(1)
  )[0];

  return byDisplay?.tool ?? null;
}
