import { z } from "zod";
import { IsoDate } from "./common.js";

export const ChatInput = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(8000),
});
export type ChatInput = z.infer<typeof ChatInput>;

export const ConfirmInput = z.object({
  pendingId: z.string().min(1),
  approved: z.boolean(),
});
export type ConfirmInput = z.infer<typeof ConfirmInput>;

export const AgentStatus = z.object({
  enabled: z.boolean(),
  provider: z.string(),
  model: z.string(),
  reason: z.string().optional(),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  text: z.string(),
  toolName: z.string().nullable(),
  createdAt: IsoDate,
});
export type AgentMessage = z.infer<typeof AgentMessage>;

export const ConversationSummary = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  messageCount: z.number(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ConversationList = z.object({ conversations: z.array(ConversationSummary) });
export type ConversationList = z.infer<typeof ConversationList>;

export const ConversationResult = z.object({ conversation: ConversationSummary });
export type ConversationResult = z.infer<typeof ConversationResult>;

export const RenameConversationInput = z.object({
  title: z.string().trim().min(1).max(80),
});
export type RenameConversationInput = z.infer<typeof RenameConversationInput>;

export const PendingConfirmation = z.object({
  pendingId: z.string(),
  name: z.string(),
  args: z.unknown(),
  createdAt: IsoDate,
});
export type PendingConfirmation = z.infer<typeof PendingConfirmation>;

export const AgentHistory = z.object({
  conversationId: z.string(),
  messages: z.array(AgentMessage),
  /** A write call waiting for approval — restored after a page reload. */
  pending: PendingConfirmation.nullable(),
});
export type AgentHistory = z.infer<typeof AgentHistory>;

// ── Prompt (assistant sub-page) ─────────────────────────────────────────
export const AgentPrompt = z.object({
  systemPrompt: z.string(),
  isDefault: z.boolean(),
});
export type AgentPrompt = z.infer<typeof AgentPrompt>;

export const UpdateAgentPromptInput = z.object({
  systemPrompt: z.string().max(4000),
});
export type UpdateAgentPromptInput = z.infer<typeof UpdateAgentPromptInput>;

// ── Model configuration (Settings) ──────────────────────────────────────
export const ModelProvider = z.enum(["deepseek", "openai", "stub"]);
export type ModelProvider = z.infer<typeof ModelProvider>;

export const AgentModelConfig = z.object({
  provider: ModelProvider,
  baseUrl: z.string(),
  model: z.string(),
  timeoutMs: z.number(),
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  source: z.enum(["db", "env", "default"]),
  enabled: z.boolean(),
});
export type AgentModelConfig = z.infer<typeof AgentModelConfig>;

export const UpdateAgentModelInput = z.object({
  provider: ModelProvider,
  baseUrl: z.string().url().optional(),
  model: z.string().trim().min(1).max(120),
  /** Omit to keep the stored key; send an empty string to clear it. */
  apiKey: z.string().max(500).optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
});
export type UpdateAgentModelInput = z.infer<typeof UpdateAgentModelInput>;

export const TestModelResult = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  message: z.string().optional(),
});
export type TestModelResult = z.infer<typeof TestModelResult>;

/** Server-sent events emitted by the chat and confirm endpoints. */
export type AgentEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; ok: boolean; preview: string; replayed?: boolean }
  | {
      type: "confirm_request";
      pendingId: string;
      name: string;
      args: unknown;
      sideEffect: "write";
    }
  | { type: "done" }
  | { type: "error"; message: string };
