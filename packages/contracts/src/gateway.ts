import { z } from "zod";
import { Id, JsonArgs } from "./common.js";

export const AppSecretResult = z.object({
  appId: Id,
  secret: z.string(),
  prefix: z.string(),
});
export type AppSecretResult = z.infer<typeof AppSecretResult>;

export const GatewayTokenInput = z.object({
  appId: Id,
  appSecret: z.string().min(1).max(500),
});
export type GatewayTokenInput = z.infer<typeof GatewayTokenInput>;

export const GatewayTokenResult = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number(),
});
export type GatewayTokenResult = z.infer<typeof GatewayTokenResult>;

export const GatewayInvokeInput = z.object({
  tool: z.string().min(1).max(128),
  args: JsonArgs.default({}),
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type GatewayInvokeInput = z.infer<typeof GatewayInvokeInput>;
