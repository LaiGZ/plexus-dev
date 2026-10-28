import { randomBytes, randomUUID } from "node:crypto";
import type { CreateTokenResult, TokenSummary } from "@plexus/contracts";
import { eq } from "drizzle-orm";
import { sha256 } from "../../infra/crypto.js";
import { db } from "../../infra/db/client.js";
import { tokenApps, tokens, type Token } from "../../infra/db/schema.js";
import { notFound } from "../../infra/errors.js";

function toSummary(row: Token, sourceIds: string[]): TokenSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope === "write" ? "write" : "read",
    sourceIds,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** Creates a token; the raw value is returned exactly once. */
export async function createToken(input: {
  name: string;
  scope?: "read" | "write";
  expiresInDays?: number;
  sourceIds?: string[];
}): Promise<CreateTokenResult> {
  const raw = `px_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = input.expiresInDays
    ? new Date(now.getTime() + input.expiresInDays * 86_400_000)
    : null;

  const row: Token = {
    id: randomUUID(),
    name: input.name,
    prefix: raw.slice(0, 10),
    hash: sha256(raw),
    scope: input.scope ?? "read",
    lastUsedAt: null,
    expiresAt,
    revokedAt: null,
    createdAt: now,
  };
  await db.insert(tokens).values(row);

  const sourceIds = [...new Set(input.sourceIds ?? [])];
  if (sourceIds.length) {
    await db.insert(tokenApps).values(sourceIds.map((sourceId) => ({ tokenId: row.id, sourceId })));
  }

  return { token: raw, summary: toSummary(row, sourceIds) };
}

export async function listTokens(): Promise<TokenSummary[]> {
  const rows = await db.select().from(tokens);
  const links = await db.select().from(tokenApps);

  const byToken = new Map<string, string[]>();
  for (const link of links) {
    byToken.set(link.tokenId, [...(byToken.get(link.tokenId) ?? []), link.sourceId]);
  }

  return rows
    .filter((row) => !row.revokedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((row) => toSummary(row, byToken.get(row.id) ?? []));
}

export async function revokeToken(id: string): Promise<void> {
  const result = await db
    .update(tokens)
    .set({ revokedAt: new Date() })
    .where(eq(tokens.id, id));
  if (result.rowsAffected === 0) throw notFound("Token not found");
  await db.delete(tokenApps).where(eq(tokenApps.tokenId, id));
}

export interface VerifiedToken {
  id: string;
  name: string;
  scope: "read" | "write";
  /** Apps this token may use. Empty means all apps. */
  sourceIds: string[];
}

/** Verifies a bearer token; returns null for unknown, revoked or expired tokens. */
export async function verifyBearerToken(raw: string): Promise<VerifiedToken | null> {
  if (!raw.startsWith("px_")) return null;
  const row = (await db.select().from(tokens).where(eq(tokens.hash, sha256(raw))).limit(1))[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(tokens).set({ lastUsedAt: new Date() }).where(eq(tokens.id, row.id));
  }

  const links = await db.select().from(tokenApps).where(eq(tokenApps.tokenId, row.id));

  return {
    id: row.id,
    name: row.name,
    scope: row.scope === "write" ? "write" : "read",
    sourceIds: links.map((link) => link.sourceId),
  };
}
