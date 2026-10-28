import { TryToolInput, UpdateToolInput } from "@plexus/contracts";
import { Hono } from "hono";
import { invokeTool } from "../domain/invoke/pipeline.js";
import { deleteTool, getToolUsage, listTools, updateTool } from "../domain/source/service.js";
import { requireAuth } from "../http/auth.js";
import { readJson } from "../http/validate.js";
import type { AppEnv } from "../types.js";

export const toolRoutes = new Hono<AppEnv>();

toolRoutes.get("/", async (c) => {
  requireAuth(c);
  return c.json({ tools: await listTools(c.req.query("sourceId")) });
});

toolRoutes.patch("/:id", async (c) => {
  requireAuth(c);
  const body = await readJson(c, UpdateToolInput);
  return c.json({ tool: await updateTool(c.req.param("id"), body) });
});

toolRoutes.get("/:id/usage", async (c) => {
  requireAuth(c);
  return c.json(await getToolUsage(c.req.param("id")));
});

toolRoutes.delete("/:id", async (c) => {
  requireAuth(c);
  await deleteTool(c.req.param("id"));
  return c.body(null, 204);
});

/**
 * Try a tool from the console. The owner can test unexposed tools, but the call
 * still goes through the full pipeline (validation, egress, idempotency, logging).
 */
toolRoutes.post("/:id/try", async (c) => {
  requireAuth(c);
  const body = await readJson(c, TryToolInput);
  const result = await invokeTool({
    toolId: c.req.param("id"),
    args: body.args ?? {},
    via: "try",
    scope: "write",
    allowUnexposed: true,
    idempotencyKey: body.idempotencyKey,
    requestId: c.get("requestId"),
  });
  return c.json(result);
});
