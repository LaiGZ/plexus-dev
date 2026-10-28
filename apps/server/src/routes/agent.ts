import {
  ChatInput,
  ConfirmInput,
  RenameConversationInput,
  UpdateAgentModelInput,
  UpdateAgentPromptInput,
} from "@plexus/contracts";
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  createConversation,
  deleteConversation,
  ensureConversation,
  getPrompt,
  history,
  listConversations,
  renameConversation,
  resolveConfirmation,
  sendMessage,
  setPrompt,
  type Emit,
} from "../domain/agent/service.js";
import { getModelConfig, modelStatus, saveModelConfig, testModel } from "../domain/agent/model.js";
import { requireAuth } from "../http/auth.js";
import { readJson } from "../http/validate.js";
import { isAppError } from "../infra/errors.js";
import type { AppEnv } from "../types.js";

export const agentRoutes = new Hono<AppEnv>();

agentRoutes.get("/status", async (c) => {
  return c.json(await modelStatus());
});

// ── Prompt (assistant sub-page) ─────────────────────────────────────────
agentRoutes.get("/prompt", async (c) => {
  requireAuth(c);
  return c.json(await getPrompt());
});

agentRoutes.put("/prompt", async (c) => {
  requireAuth(c);
  const body = await readJson(c, UpdateAgentPromptInput);
  return c.json(await setPrompt(body.systemPrompt));
});

// ── Model configuration (Settings) ──────────────────────────────────────
agentRoutes.get("/model", async (c) => {
  requireAuth(c);
  return c.json(await getModelConfig());
});

agentRoutes.put("/model", async (c) => {
  requireAuth(c);
  const body = await readJson(c, UpdateAgentModelInput);
  return c.json(await saveModelConfig(body));
});

agentRoutes.post("/model/test", async (c) => {
  requireAuth(c);
  return c.json(await testModel());
});

// ── Conversations ───────────────────────────────────────────────────────
agentRoutes.get("/conversations", async (c) => {
  requireAuth(c);
  return c.json({ conversations: await listConversations() });
});

agentRoutes.post("/conversations", async (c) => {
  requireAuth(c);
  return c.json({ conversation: await createConversation() }, 201);
});

agentRoutes.patch("/conversations/:id", async (c) => {
  requireAuth(c);
  const body = await readJson(c, RenameConversationInput);
  return c.json({ conversation: await renameConversation(c.req.param("id"), body.title) });
});

agentRoutes.delete("/conversations/:id", async (c) => {
  requireAuth(c);
  await deleteConversation(c.req.param("id"));
  return c.body(null, 204);
});

agentRoutes.get("/conversations/:id/messages", async (c) => {
  requireAuth(c);
  return c.json(await history(c.req.param("id")));
});

// ── Chat ────────────────────────────────────────────────────────────────
function sse(c: Context<AppEnv>, run: (emit: Emit) => Promise<void>) {
  return streamSSE(c, async (stream) => {
    const emit: Emit = async (event) => {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    };
    try {
      await run(emit);
    } catch (err) {
      const message = isAppError(err) ? err.message : "The assistant failed";
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ type: "error", message }),
      });
    }
  });
}

agentRoutes.post("/chat", async (c) => {
  requireAuth(c);
  const body = await readJson(c, ChatInput);
  const conversationId = body.conversationId ?? (await ensureConversation());
  return sse(c, (emit) => sendMessage(conversationId, body.message, emit));
});

agentRoutes.post("/confirm", async (c) => {
  requireAuth(c);
  const body = await readJson(c, ConfirmInput);
  return sse(c, (emit) => resolveConfirmation(body.pendingId, body.approved, emit));
});
