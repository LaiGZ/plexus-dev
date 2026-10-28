import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { config } from "../../config.js";
import { logger } from "../logger.js";
import * as schema from "./schema.js";

export const client = createClient({ url: config.databaseUrl });
export const db = drizzle(client, { schema });

/** WAL + busy timeout: the right defaults for a single-process SQLite server. */
export async function applyPragmas(): Promise<void> {
  if (config.databaseUrl === ":memory:") return;
  for (const pragma of [
    "PRAGMA journal_mode = WAL",
    "PRAGMA busy_timeout = 5000",
    "PRAGMA foreign_keys = ON",
    "PRAGMA synchronous = NORMAL",
  ]) {
    try {
      await client.execute(pragma);
    } catch (err) {
      logger.warn({ pragma, err }, "pragma failed (continuing)");
    }
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    await client.execute("select 1");
    return true;
  } catch {
    return false;
  }
}

export function closeDb(): void {
  client.close();
}

export { schema };
