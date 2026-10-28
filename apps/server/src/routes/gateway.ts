import { createHash } from "node:crypto";
import { GatewayInvokeInput, GatewayTokenInput } from "@plexus/contracts";
import { Hono } from "hono";
import {
  exchangeAppSecret,
  findExposedTool,
  issueAppSecret,
  verifyServiceToken,
} from "../domain/gateway/app-auth.js";
import { invokeTool } from "../domain/invoke/pipeline.js";
import { getAppGrants } from "../domain/source/service.js";
import { requireAuth } from "../http/auth.js";
import { readJson } from "../http/validate.js";
import { forbidden, notFound, unauthorized } from "../infra/errors.js";
import type { AppEnv } from "../types.js";

export const gatewayRoutes = new Hono<AppEnv>();

/** App exchanges app_id + app_secret for a short-lived service token. */
gatewayRoutes.post("/token", async (c) => {
  const body = await readJson(c, GatewayTokenInput);
  const result = await exchangeAppSecret(body.appId, body.appSecret);
  return c.json({
    accessToken: result.accessToken,
    tokenType: "Bearer" as const,
    expiresIn: result.expiresIn,
  });
});

/** App-to-app call: same pipeline as MCP, attributed to the calling app. */
gatewayRoutes.post("/invoke", async (c) => {
  const raw = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) throw unauthorized("missing_service_token");

  const principal = await verifyServiceToken(raw);
  if (!principal) throw unauthorized("invalid_service_token");

  const body = await readJson(c, GatewayInvokeInput);
  const tool = await findExposedTool(body.tool);
  if (!tool) throw notFound("tool_not_found_or_not_exposed");

  // Cross-app calls require an explicit grant; an app may always call its own tools.
  if (tool.sourceId !== principal.sourceId) {
    const grants = await getAppGrants(principal.sourceId);
    if (!grants.includes(tool.id)) {
      throw forbidden(
        "no_grant",
        "This app is not allowed to call that tool. Ask the owner to grant it.",
      );
    }
  }

  const idempotencyKey =
    body.idempotencyKey ??
    `app:${createHash("sha256")
      .update(`${principal.sourceId}|${tool.id}|${JSON.stringify(body.args)}`)
      .digest("hex")}`;

  const result = await invokeTool({
    toolId: tool.id,
    args: body.args,
    via: "gateway-app",
    scope: "write",
    idempotencyKey,
    actorType: "app",
    actorId: principal.sourceId,
    requestId: c.get("requestId"),
  });

  return c.json(result, 201);
});

/** Issue or rotate the calling app's own secret (owner only). */
gatewayRoutes.post("/apps/:id/secret", async (c) => {
  requireAuth(c);
  const result = await issueAppSecret(c.req.param("id"));
  return c.json({ appId: c.req.param("id"), secret: result.secret, prefix: result.prefix }, 201);
});
