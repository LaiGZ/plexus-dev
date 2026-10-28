import { Hono } from "hono";
import { getStats } from "../domain/stats/service.js";
import { requireAuth } from "../http/auth.js";
import type { AppEnv } from "../types.js";

export const statsRoutes = new Hono<AppEnv>();

statsRoutes.get("/", async (c) => {
  requireAuth(c);
  return c.json(await getStats());
});
