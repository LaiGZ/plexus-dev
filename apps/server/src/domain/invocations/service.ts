import type { InvocationPage, InvocationQuery, InvocationSummary } from "@plexus/contracts";
import { and, desc, eq, lt } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../infra/db/client.js";
import { invocations } from "../../infra/db/schema.js";
import { logger } from "../../infra/logger.js";

export interface InvocationRecord {
  toolId: string | null;
  toolName: string | null;
  sourceId: string | null;
  tokenId: string | null;
  actorType: string | null;
  actorId: string | null;
  via: string;
  status: "ok" | "error" | "replayed";
  latencyMs: number | null;
  requestPreview: string | null;
  responsePreview: string | null;
  errorCode: string | null;
  requestId: string | null;
}

/** Logging must never break a call, so failures are swallowed and reported. */
export async function recordInvocation(record: InvocationRecord): Promise<void> {
  try {
    await db.insert(invocations).values({ ...record, ts: new Date() });
  } catch (err) {
    logger.warn({ err, toolId: record.toolId }, "failed to record invocation");
  }
}

export async function listInvocations(query: InvocationQuery): Promise<InvocationPage> {
  const filters = [];
  if (query.toolId) filters.push(eq(invocations.toolId, query.toolId));
  if (query.sourceId) filters.push(eq(invocations.sourceId, query.sourceId));
  if (query.status) filters.push(eq(invocations.status, query.status));
  if (query.actorType) filters.push(eq(invocations.actorType, query.actorType));
  if (query.cursor) {
    const cursorId = Number(query.cursor);
    if (Number.isFinite(cursorId)) filters.push(lt(invocations.id, cursorId));
  }

  const rows = await db
    .select()
    .from(invocations)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(invocations.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const next = rows.length > query.limit ? (page.at(-1)?.id ?? null) : null;

  return {
    invocations: page.map(
      (row): InvocationSummary => ({
        id: String(row.id),
        ts: row.ts.toISOString(),
        toolId: row.toolId,
        toolName: row.toolName,
        sourceId: row.sourceId,
        tokenId: row.tokenId,
        actorType: row.actorType,
        actorId: row.actorId,
        via: row.via,
        status: row.status === "ok" || row.status === "replayed" ? row.status : "error",
        latencyMs: row.latencyMs,
        requestPreview: row.requestPreview,
        responsePreview: row.responsePreview,
        errorCode: row.errorCode,
        requestId: row.requestId,
      }),
    ),
    nextCursor: next === null ? null : String(next),
  };
}

export async function cleanupInvocations(): Promise<number> {
  const cutoff = new Date(Date.now() - config.invocationRetentionDays * 86_400_000);
  const result = await db.delete(invocations).where(lt(invocations.ts, cutoff));
  return result.rowsAffected;
}
