import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "../../config.js";
import { generatePassword, hashPassword } from "../crypto.js";
import { logger } from "../logger.js";
import { db } from "./client.js";
import { roles, users } from "./schema.js";

const SUPER_ADMIN = "super_admin";

function announceGeneratedPassword(username: string, password: string): void {
  const line = "─".repeat(64);
  process.stdout.write(
    [
      "",
      line,
      "  Initial administrator created",
      "",
      `    username: ${username}`,
      `    password: ${password}`,
      "",
      "  This password is shown only once. Sign in and change it now.",
      "  (Lost it? Delete data/plexus.db and restart, or set PLEXUS_ADMIN_PASSWORD.)",
      line,
      "",
    ].join("\n"),
  );
}

/**
 * Idempotent first-boot seed:
 *  - always ensures the `super_admin` role exists
 *  - creates the single admin user with a random password if no user exists
 */
export async function seed(): Promise<{ created: boolean }> {
  let role = (await db.select().from(roles).where(eq(roles.key, SUPER_ADMIN)).limit(1))[0];
  if (!role) {
    role = {
      id: randomUUID(),
      key: SUPER_ADMIN,
      name: "Super Administrator",
      permissions: JSON.stringify(["*"]),
      createdAt: new Date(),
    };
    await db.insert(roles).values(role);
    logger.info({ role: role.key }, "role created");
  }

  const existing = (await db.select().from(users).limit(1))[0];
  if (existing) {
    logger.info({ username: existing.username }, "admin user exists, seed skipped");
    return { created: false };
  }

  const password = config.adminPassword ?? generatePassword();
  const generated = !config.adminPassword;

  await db.insert(users).values({
    id: randomUUID(),
    username: config.adminUsername,
    passwordHash: await hashPassword(password),
    roleId: role.id,
    status: "active",
    mustChangePassword: generated,
    createdAt: new Date(),
  });

  if (generated) {
    announceGeneratedPassword(config.adminUsername, password);
  } else {
    logger.info(
      { username: config.adminUsername },
      "admin user created from PLEXUS_ADMIN_PASSWORD",
    );
  }

  return { created: true };
}
