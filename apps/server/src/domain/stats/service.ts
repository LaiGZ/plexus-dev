import { gte } from "drizzle-orm";
import { db } from "../../infra/db/client.js";
import { invocations, sources, tokens, tools } from "../../infra/db/schema.js";

export interface Stats {
  sources: number;
  tools: number;
  exposedTools: number;
  tokens: number;
  invocationsToday: number;
  errorsToday: number;
}

export async function getStats(): Promise<Stats> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [sourceRows, toolRows, tokenRows, invocationRows] = await Promise.all([
    db.select({ id: sources.id }).from(sources),
    db.select({ exposed: tools.exposed }).from(tools),
    db.select({ revokedAt: tokens.revokedAt }).from(tokens),
    db
      .select({ status: invocations.status })
      .from(invocations)
      .where(gte(invocations.ts, since)),
  ]);

  return {
    sources: sourceRows.length,
    tools: toolRows.length,
    exposedTools: toolRows.filter((t) => t.exposed).length,
    tokens: tokenRows.filter((t) => !t.revokedAt).length,
    invocationsToday: invocationRows.length,
    errorsToday: invocationRows.filter((i) => i.status === "error").length,
  };
}
