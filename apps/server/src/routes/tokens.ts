import { CreateTokenInput } from "@plexus/contracts";
import { Hono } from "hono";
import { requireAuth } from "../http/auth.js";
import { readJson } from "../http/validate.js";
import { createToken, listTokens, revokeToken } from "../domain/tokens/service.js";
import type { AppEnv } from "../types.js";

export const tokenRoutes = new Hono<AppEnv>();

tokenRoutes.get("/", async (c) => {
  requireAuth(c);
  return c.json({ tokens: await listTokens() });
});

tokenRoutes.post("/", async (c) => {
  requireAuth(c);
  const body = await readJson(c, CreateTokenInput);
  const result = await createToken(body);
  return c.json(result, 201);
});

tokenRoutes.delete("/:id", async (c) => {
  requireAuth(c);
  await revokeToken(c.req.param("id"));
  return c.body(null, 204);
});
