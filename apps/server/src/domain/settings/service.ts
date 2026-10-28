import { eq } from "drizzle-orm";
import { db } from "../../infra/db/client.js";
import { settings } from "../../infra/db/schema.js";

export async function getSetting(key: string): Promise<string | null> {
  const row = (await db.select().from(settings).where(eq(settings.key, key)).limit(1))[0];
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const now = new Date();
  await db
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
}
