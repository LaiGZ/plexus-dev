import { InvocationQuery } from "@plexus/contracts";
import { Hono } from "hono";
import { listInvocations } from "../domain/invocations/service.js";
import { requireAuth } from "../http/auth.js";
import { badRequest } from "../infra/errors.js";
import type { AppEnv } from "../types.js";

export const invocationRoutes = new Hono<AppEnv>();

invocationRoutes.get("/", async (c) => {
  requireAuth(c);
  const parsed = InvocationQuery.safeParse(c.req.query());
  if (!parsed.success) {
    throw badRequest(
      "Invalid query parameters",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return c.json(await listInvocations(parsed.data));
});
