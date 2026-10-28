import { Hono } from "hono";
import { config } from "../config.js";
import { db } from "../infra/db/client.js";
import { users } from "../infra/db/schema.js";
import type { AppEnv } from "../types.js";

export const metaRoutes = new Hono<AppEnv>();

/** Public bootstrap info used by the login screen. Contains no secrets. */
metaRoutes.get("/meta", async (c) => {
  const admin = (await db.select({ id: users.id }).from(users).limit(1))[0];
  return c.json({
    product: "plexus",
    version: config.version,
    initialized: Boolean(admin),
    publicUrl: config.publicUrl,
    mcpEndpoint: `${config.publicUrl}/mcp`,
  });
});
