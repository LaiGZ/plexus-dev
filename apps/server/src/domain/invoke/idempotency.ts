import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { sha256 } from "../../infra/crypto.js";
import { db } from "../../infra/db/client.js";
import { idempotencyRecords } from "../../infra/db/schema.js";
import { AppError } from "../../infra/errors.js";

const LEASE_MS = 30_000;
const TTL_MS = 24 * 3_600_000;

export type BeginResult =
  | { proceed: true; id: string }
  | { proceed: false; response: unknown };

export function digestArgs(args: unknown): string {
  return sha256(JSON.stringify(args ?? null));
}

/**
 * Three-state ledger: done → replay, in_progress → conflict, digest mismatch → conflict.
 * A crashed caller's lease can be taken over after 30s.
 */
export async function beginIdempotency(
  scopeKey: string,
  key: string,
  digest: string,
): Promise<BeginResult> {
  const id = randomUUID();
  const keyHash = sha256(key);
  const now = new Date();

  await db
    .insert(idempotencyRecords)
    .values({
      id,
      scopeKey,
      keyHash,
      requestDigest: digest,
      state: "in_progress",
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      expiresAt: new Date(now.getTime() + TTL_MS),
      createdAt: now,
    })
    .onConflictDoNothing();

  const row = (
    await db
      .select()
      .from(idempotencyRecords)
      .where(and(eq(idempotencyRecords.scopeKey, scopeKey), eq(idempotencyRecords.keyHash, keyHash)))
      .limit(1)
  )[0];

  if (!row) throw new AppError("internal", 500, "Idempotency ledger unavailable");
  if (row.id === id) return { proceed: true, id };

  if (row.requestDigest !== digest) {
    throw new AppError(
      "idempotency_mismatch",
      409,
      "This idempotency key was already used with different arguments",
      "Reuse the key only for identical retries",
    );
  }
  if (row.state === "done") {
    let response: unknown = null;
    try {
      response = row.responseRef ? JSON.parse(row.responseRef) : null;
    } catch {
      response = null;
    }
    return { proceed: false, response };
  }
  if (row.state === "in_progress" && row.leaseUntil && row.leaseUntil.getTime() > Date.now()) {
    throw new AppError(
      "idempotency_in_progress",
      409,
      "An identical request is already in progress",
      "Wait for it to finish, or retry with the same key",
    );
  }

  await db
    .update(idempotencyRecords)
    .set({ leaseUntil: new Date(Date.now() + LEASE_MS), state: "in_progress" })
    .where(eq(idempotencyRecords.id, row.id));

  return { proceed: true, id: row.id };
}

export async function completeIdempotency(id: string, response: unknown): Promise<void> {
  await db
    .update(idempotencyRecords)
    .set({ state: "done", responseRef: JSON.stringify(response), leaseUntil: null })
    .where(eq(idempotencyRecords.id, id));
}

export async function failIdempotency(id: string): Promise<void> {
  await db
    .update(idempotencyRecords)
    .set({ state: "failed", leaseUntil: null })
    .where(eq(idempotencyRecords.id, id));
}
