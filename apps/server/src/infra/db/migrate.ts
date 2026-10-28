import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { packageRoot } from "../../config.js";
import { db } from "./client.js";

/**
 * Migrations run automatically on boot: a self-hosted single-binary product
 * should never require the operator to run a migration command by hand.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolve(packageRoot, "drizzle");
  await migrate(db, { migrationsFolder });
}
