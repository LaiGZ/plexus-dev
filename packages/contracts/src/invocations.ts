import { z } from "zod";
import { Id, IsoDate, JsonArgs, Scope } from "./common.js";

export const TryToolInput = z.object({
  args: JsonArgs.default({}),
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type TryToolInput = z.infer<typeof TryToolInput>;

export const InvocationStatus = z.enum(["ok", "error", "replayed"]);
export type InvocationStatus = z.infer<typeof InvocationStatus>;

export const InvocationSummary = z.object({
  id: z.string(),
  ts: IsoDate,
  toolId: z.string().nullable(),
  toolName: z.string().nullable(),
  sourceId: z.string().nullable(),
  tokenId: z.string().nullable(),
  actorType: z.string().nullable(),
  actorId: z.string().nullable(),
  via: z.string(),
  status: InvocationStatus,
  latencyMs: z.number().nullable(),
  requestPreview: z.string().nullable(),
  responsePreview: z.string().nullable(),
  errorCode: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type InvocationSummary = z.infer<typeof InvocationSummary>;

export const InvocationPage = z.object({
  invocations: z.array(InvocationSummary),
  nextCursor: z.string().nullable(),
});
export type InvocationPage = z.infer<typeof InvocationPage>;

export const InvocationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  toolId: z.string().optional(),
  sourceId: z.string().optional(),
  status: InvocationStatus.optional(),
  actorType: z.enum(["user", "mcp", "app", "agent"]).optional(),
});
export type InvocationQuery = z.infer<typeof InvocationQuery>;

export const InvokeResult = z.object({
  ok: z.literal(true),
  data: z.unknown(),
  traceId: z.string(),
  latencyMs: z.number(),
  replayed: z.boolean().optional(),
});
export type InvokeResult = z.infer<typeof InvokeResult>;

/** Token subject attached to an invocation. */
export const InvokeSubject = z.object({
  tokenId: Id.optional(),
  scope: Scope,
});
export type InvokeSubject = z.infer<typeof InvokeSubject>;
