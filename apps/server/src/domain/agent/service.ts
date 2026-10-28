import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentMessage,
  AgentPrompt,
  ConversationSummary,
  PendingConfirmation,
} from "@plexus/contracts";
import { and, count, desc, eq } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../infra/db/client.js";
import {
  conversations,
  messages,
  pendingToolCalls,
  sources,
  tools,
} from "../../infra/db/schema.js";
import { AppError, badRequest, conflict, isAppError, notFound } from "../../infra/errors.js";
import { invokeTool } from "../invoke/pipeline.js";
import { getSetting, setSetting } from "../settings/service.js";
import { chat, type ModelMessage, type ModelTool } from "./model.js";

const PROMPT_KEY = "agent.system_prompt";

export const DEFAULT_SYSTEM_PROMPT = [
  "You are the built-in assistant of a personal Plexus instance.",
  "Use the provided tools for facts and actions; never invent tool results.",
  "Some tools modify data and require the owner's approval: say what you are about to do before calling them.",
  "Answer in the user's language, concisely.",
].join("\n");

const HISTORY_LIMIT = 30;
const DEFAULT_TITLE = "New conversation";

interface StoredContent {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
  toolName?: string;
  result?: unknown;
  error?: string;
  rejected?: boolean;
}

export type Emit = (event: AgentEvent) => void | Promise<void>;

// ── Prompt ──────────────────────────────────────────────────────────────

export async function getPrompt(): Promise<AgentPrompt> {
  const stored = await getSetting(PROMPT_KEY);
  return {
    systemPrompt: stored ?? DEFAULT_SYSTEM_PROMPT,
    isDefault: !stored,
  };
}

export async function setPrompt(systemPrompt: string): Promise<AgentPrompt> {
  const trimmed = systemPrompt.trim();
  if (!trimmed) {
    await setSetting(PROMPT_KEY, "");
    return { systemPrompt: DEFAULT_SYSTEM_PROMPT, isDefault: true };
  }
  await setSetting(PROMPT_KEY, trimmed);
  return { systemPrompt: trimmed, isDefault: false };
}

// ── Conversations ───────────────────────────────────────────────────────

function toSummary(
  row: typeof conversations.$inferSelect,
  messageCount = 0,
): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount,
  };
}

export async function createConversation(title = DEFAULT_TITLE): Promise<ConversationSummary> {
  const now = new Date();
  const row = {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(conversations).values(row);
  return toSummary(row, 0);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  const counts = await db
    .select({ conversationId: messages.conversationId, total: count() })
    .from(messages)
    .groupBy(messages.conversationId);
  const byId = new Map(counts.map((row) => [row.conversationId, Number(row.total)]));
  return rows.map((row) => toSummary(row, byId.get(row.id) ?? 0));
}

export async function ensureConversation(): Promise<string> {
  const existing = (
    await db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(1)
  )[0];
  if (existing) return existing.id;
  return (await createConversation()).id;
}

export async function renameConversation(id: string, title: string): Promise<ConversationSummary> {
  const row = (await db.select().from(conversations).where(eq(conversations.id, id)).limit(1))[0];
  if (!row) throw notFound("Conversation not found");
  await db
    .update(conversations)
    .set({ title: title.trim(), updatedAt: new Date() })
    .where(eq(conversations.id, id));
  return toSummary({ ...row, title: title.trim() });
}

export async function deleteConversation(id: string): Promise<void> {
  const row = (await db.select().from(conversations).where(eq(conversations.id, id)).limit(1))[0];
  if (!row) throw notFound("Conversation not found");
  await db.delete(pendingToolCalls).where(eq(pendingToolCalls.conversationId, id));
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
}

// ── Messages ────────────────────────────────────────────────────────────

function parseContent(raw: string): StoredContent {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as StoredContent) : {};
  } catch {
    return { text: raw };
  }
}

function preview(value: unknown, max = 300): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function insertMessage(
  conversationId: string,
  role: "user" | "assistant" | "tool",
  content: StoredContent,
): Promise<void> {
  await db.insert(messages).values({
    conversationId,
    role,
    content: JSON.stringify(content),
    createdAt: new Date(),
  });
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

async function loadMessages(conversationId: string): Promise<Array<typeof messages.$inferSelect>> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(HISTORY_LIMIT);
  return rows.reverse();
}

async function buildModelMessages(
  conversationId: string,
  systemPrompt: string,
): Promise<ModelMessage[]> {
  const rows = await loadMessages(conversationId);
  const modelMessages: ModelMessage[] = [{ role: "system", content: systemPrompt }];

  for (const row of rows) {
    const content = parseContent(row.content);
    if (row.role === "user") {
      modelMessages.push({ role: "user", content: content.text ?? "" });
    } else if (row.role === "assistant") {
      if (!content.text && !content.toolCalls?.length) continue;
      modelMessages.push({
        role: "assistant",
        content: content.text ?? "",
        ...(content.toolCalls?.length ? { toolCalls: content.toolCalls } : {}),
      });
    } else {
      modelMessages.push({
        role: "tool",
        content: JSON.stringify(content.error ? { error: content.error } : (content.result ?? null)),
        ...(content.toolCallId ? { toolCallId: content.toolCallId } : {}),
      });
    }
  }

  return modelMessages;
}

async function loadAvailableTools(): Promise<ModelTool[]> {
  const rows = await db
    .select({ tool: tools })
    .from(tools)
    .innerJoin(sources, eq(tools.sourceId, sources.id))
    .where(and(eq(tools.exposed, true), eq(tools.enabled, true), eq(sources.enabled, true)));

  return rows.map(({ tool }) => ({
    name: tool.mcpName,
    description: tool.description || tool.name,
    parameters: (() => {
      try {
        return JSON.parse(tool.inputSchema) as unknown;
      } catch {
        return { type: "object", properties: {} };
      }
    })(),
    sideEffect: tool.sideEffect === "write" ? "write" : "read",
  }));
}

async function findToolByName(name: string) {
  const row = (
    await db
      .select({ tool: tools })
      .from(tools)
      .innerJoin(sources, eq(tools.sourceId, sources.id))
      .where(and(eq(tools.mcpName, name), eq(sources.enabled, true)))
      .limit(1)
  )[0];
  return row?.tool ?? null;
}

async function executeTool(
  toolId: string,
  args: Record<string, unknown>,
  scope: "read" | "write",
  idempotencyKey: string,
): Promise<{ result?: unknown; error?: string; replayed?: boolean }> {
  try {
    const response = await invokeTool({
      toolId,
      args,
      via: "agent",
      scope,
      idempotencyKey,
      allowUnexposed: true,
    });
    return { result: response.data, replayed: response.replayed };
  } catch (err) {
    return { error: isAppError(err) ? err.message : "Tool call failed" };
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function pendingFor(conversationId: string): Promise<PendingConfirmation | null> {
  const row = (
    await db
      .select()
      .from(pendingToolCalls)
      .where(
        and(
          eq(pendingToolCalls.conversationId, conversationId),
          eq(pendingToolCalls.status, "pending"),
        ),
      )
      .orderBy(desc(pendingToolCalls.createdAt))
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    pendingId: row.id,
    name: row.toolName,
    args: parseArgs(row.args),
    createdAt: row.createdAt.toISOString(),
  };
}

async function runLoop(
  conversationId: string,
  systemPrompt: string,
  emit: Emit,
): Promise<void> {
  const available = await loadAvailableTools();

  for (let step = 0; step < config.agentMaxSteps; step += 1) {
    const modelMessages = await buildModelMessages(conversationId, systemPrompt);
    let reply;
    try {
      reply = await chat(modelMessages, available, async (delta) => {
        await emit({ type: "assistant_delta", text: delta });
      });
    } catch (err) {
      const message = isAppError(err) ? err.message : "The model call failed";
      await emit({ type: "error", message });
      return;
    }

    if (reply.toolCalls.length === 0) {
      await insertMessage(conversationId, "assistant", { text: reply.text });
      if (reply.text) await emit({ type: "assistant", text: reply.text });
      await emit({ type: "done" });
      return;
    }

    await insertMessage(conversationId, "assistant", {
      text: reply.text,
      toolCalls: reply.toolCalls,
    });
    if (reply.text) await emit({ type: "assistant", text: reply.text });

    let paused = false;
    for (const call of reply.toolCalls) {
      // Every tool_call in the assistant message must get a tool result, even the
      // ones we skip after pausing — otherwise strict providers reject the next turn.
      if (paused) {
        await insertMessage(conversationId, "tool", {
          toolCallId: call.id,
          toolName: call.name,
          error: "Skipped: an earlier tool call is waiting for the owner's approval",
        });
        await emit({
          type: "tool_result",
          name: call.name,
          ok: false,
          preview: "Skipped: waiting for approval of an earlier tool call",
        });
        continue;
      }

      const tool = await findToolByName(call.name);
      const args = parseArgs(call.arguments);

      if (!tool) {
        await insertMessage(conversationId, "tool", {
          toolCallId: call.id,
          toolName: call.name,
          error: `Unknown tool: ${call.name}`,
        });
        await emit({ type: "tool_result", name: call.name, ok: false, preview: "unknown tool" });
        continue;
      }

      await emit({ type: "tool_call", name: call.name, args });

      if (tool.sideEffect === "write") {
        const pendingId = randomUUID();
        await db.insert(pendingToolCalls).values({
          id: pendingId,
          conversationId,
          toolId: tool.id,
          toolName: call.name,
          toolCallId: call.id,
          args: JSON.stringify(args),
          status: "pending",
          createdAt: new Date(),
        });
        await emit({
          type: "confirm_request",
          pendingId,
          name: call.name,
          args,
          sideEffect: "write",
        });
        paused = true;
        continue;
      }

      const outcome = await executeTool(tool.id, args, "read", `agent:${call.id}`);
      await insertMessage(conversationId, "tool", {
        toolCallId: call.id,
        toolName: call.name,
        ...outcome,
      });
      await emit({
        type: "tool_result",
        name: call.name,
        ok: !outcome.error,
        preview: preview(outcome.error ?? outcome.result),
        ...(outcome.replayed ? { replayed: true } : {}),
      });
    }

    if (paused) return;
  }

  await emit({ type: "error", message: "Stopped after reaching the step limit" });
}

// ── Public API ──────────────────────────────────────────────────────────

export async function history(conversationId: string): Promise<{
  conversationId: string;
  messages: AgentMessage[];
  pending: PendingConfirmation | null;
}> {
  const rows = await loadMessages(conversationId);
  const out: AgentMessage[] = [];

  for (const row of rows) {
    const content = parseContent(row.content);
    if (row.role === "user") {
      out.push({
        id: String(row.id),
        role: "user",
        text: content.text ?? "",
        toolName: null,
        createdAt: row.createdAt.toISOString(),
      });
    } else if (row.role === "assistant") {
      if (!content.text) continue;
      out.push({
        id: String(row.id),
        role: "assistant",
        text: content.text,
        toolName: null,
        createdAt: row.createdAt.toISOString(),
      });
    } else {
      out.push({
        id: String(row.id),
        role: "tool",
        text: content.error ?? preview(content.result, 500),
        toolName: content.toolName ?? null,
        createdAt: row.createdAt.toISOString(),
      });
    }
  }

  return {
    conversationId,
    messages: out,
    pending: await pendingFor(conversationId),
  };
}

export async function sendMessage(
  conversationId: string,
  text: string,
  emit: Emit,
): Promise<void> {
  const conversation = (
    await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  )[0];
  if (!conversation) throw notFound("Conversation not found");

  if (await pendingFor(conversationId)) {
    throw conflict(
      "Resolve the pending tool call first",
      "Approve or reject the confirmation before sending another message",
    );
  }

  const prompt = await getPrompt();
  if (!prompt.systemPrompt) throw badRequest("System prompt is empty");

  await insertMessage(conversationId, "user", { text });

  if (conversation.title === DEFAULT_TITLE) {
    const title = text.replace(/\s+/g, " ").trim().slice(0, 40);
    if (title) {
      await db
        .update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }
  }

  await runLoop(conversationId, prompt.systemPrompt, emit);
}

export async function resolveConfirmation(
  pendingId: string,
  approved: boolean,
  emit: Emit,
): Promise<void> {
  const pending = (
    await db.select().from(pendingToolCalls).where(eq(pendingToolCalls.id, pendingId)).limit(1)
  )[0];
  if (!pending) throw notFound("Confirmation not found");
  if (pending.status !== "pending") {
    throw new AppError("conflict", 409, "This tool call was already resolved");
  }

  await db
    .update(pendingToolCalls)
    .set({ status: approved ? "approved" : "rejected", resolvedAt: new Date() })
    .where(eq(pendingToolCalls.id, pendingId));

  if (!approved) {
    await insertMessage(pending.conversationId, "tool", {
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      rejected: true,
      error: "Rejected by the owner",
    });
    await emit({
      type: "tool_result",
      name: pending.toolName,
      ok: false,
      preview: "Rejected by the owner",
    });
  } else {
    const args = parseArgs(pending.args);
    const outcome = await executeTool(pending.toolId, args, "write", `agent:${pending.id}`);
    await insertMessage(pending.conversationId, "tool", {
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      ...outcome,
    });
    await emit({
      type: "tool_result",
      name: pending.toolName,
      ok: !outcome.error,
      preview: preview(outcome.error ?? outcome.result),
      ...(outcome.replayed ? { replayed: true } : {}),
    });
  }

  const prompt = await getPrompt();
  await runLoop(pending.conversationId, prompt.systemPrompt, emit);
}
