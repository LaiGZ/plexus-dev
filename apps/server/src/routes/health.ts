import { Hono } from "hono";
import { config } from "../config.js";
import { pingDb } from "../infra/db/client.js";

export const healthRoutes = new Hono();

healthRoutes.get("/healthz", async (c) => {
  const dbOk = await pingDb();
  return c.json(
    {
      ok: dbOk,
      service: "plexus",
      version: config.version,
      db: dbOk ? "ok" : "error",
      uptimeMs: Math.round(process.uptime() * 1000),
    },
    dbOk ? 200 : 503,
  );
});
