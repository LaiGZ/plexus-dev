import { z } from "zod";
import { Id, IsoDate, Scope } from "./common.js";

export const CreateTokenInput = z.object({
  name: z.string().trim().min(1).max(64),
  scope: Scope.default("read"),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  /** Restrict the token to these apps. Empty means all apps. */
  sourceIds: z.array(z.string().min(1)).max(100).default([]),
});
export type CreateTokenInput = z.infer<typeof CreateTokenInput>;

export const TokenSummary = z.object({
  id: Id,
  name: z.string(),
  prefix: z.string(),
  scope: Scope,
  sourceIds: z.array(z.string()),
  lastUsedAt: IsoDate.nullable(),
  expiresAt: IsoDate.nullable(),
  createdAt: IsoDate,
  revokedAt: IsoDate.nullable(),
});
export type TokenSummary = z.infer<typeof TokenSummary>;

export const TokenList = z.object({ tokens: z.array(TokenSummary) });
export type TokenList = z.infer<typeof TokenList>;

export const CreateTokenResult = z.object({
  token: z.string(),
  summary: TokenSummary,
});
export type CreateTokenResult = z.infer<typeof CreateTokenResult>;
