import type { AgentEvent } from "@plexus/contracts";
import { eq } from "drizzle-orm";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../infra/db/migrate.js";
import { db } from "../../infra/db/client.js";
import { messages } from "../../infra/db/schema.js";
import { getModelConfig, modelStatus, saveModelConfig, testModel } from "./model.js";
import {
  createConversation,
  deleteConversation,
  getPrompt,
  history,
  listConversations,
  renameConversation,
  resolveConfirmation,
  sendMessage,
  setPrompt,
} from "./service.js";
import { createSource, updateTool } from "../source/service.js";

let server: ReturnType<typeof createServer>;
let calls = 0;

beforeAll(async () => {
  await runMigrations();

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/count")) {
        calls += 1;
        res.end(JSON.stringify({ hits: calls }));
        return;
      }
      res.end(JSON.stringify({ echo: Buffer.concat(chunks).toString("utf8") || null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const created = await createSource({
    name: "Agent API",
    kind: "http",
    baseUrl: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    headers: {},
    tools: [
      {
        name: "echo",
        description: "Echo text",
        method: "POST",
        path: "/echo",
        sideEffect: "read",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "bump",
        description: "Increment a counter",
        method: "POST",
        path: "/count",
        sideEffect: "write",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  });

  for (const tool of created.tools) {
    await updateTool(tool.id, { exposed: true });
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function collect() {
  const events: AgentEvent[] = [];
  return {
    events,
    emit: (event: AgentEvent) => {
      events.push(event);
    },
  };
}

describe("model configuration", () => {
  it("reports the stub provider as enabled", async () => {
    const status = await modelStatus();
    expect(status.enabled).toBe(true);
    expect(status.provider).toBe("stub");
  });

  it("persists a model override and never exposes the key", async () => {
    const saved = await saveModelConfig({
      provider: "openai",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      apiKey: "sk-secret-1234",
      timeoutMs: 30_000,
    });
    expect(saved.provider).toBe("openai");
    expect(saved.model).toBe("test-model");
    expect(saved.source).toBe("db");
    expect(saved.hasKey).toBe(true);
    expect(saved.keyHint).toBe("••••1234");
    expect(JSON.stringify(saved)).not.toContain("sk-secret");

    const config = await getModelConfig();
    expect(config.baseUrl).toBe("https://example.com/v1");

    const test = await testModel();
    expect(test.ok).toBe(false);
    expect(test.message).toBeTruthy();

    // Restore the stub so the rest of the suite stays offline and deterministic.
    await saveModelConfig({ provider: "stub", model: "stub" });
  });
});

describe("conversations", () => {
  it("creates, renames, lists and deletes", async () => {
    const created = await createConversation();
    expect(created.title).toBe("New conversation");

    const renamed = await renameConversation(created.id, "Renamed thread");
    expect(renamed.title).toBe("Renamed thread");

    const listed = await listConversations();
    expect(listed.some((c) => c.id === created.id)).toBe(true);

    await deleteConversation(created.id);
    const after = await listConversations();
    expect(after.some((c) => c.id === created.id)).toBe(false);
  });

  it("derives the title from the first user message", async () => {
    const conversation = await createConversation();
    const { emit } = collect();
    await sendMessage(conversation.id, "please read something", emit);
    const listed = await listConversations();
    expect(listed.find((c) => c.id === conversation.id)?.title).toBe("please read something");
  });
});

describe("assistant loop", () => {
  it("runs a read tool and finishes with a reply", async () => {
    const conversation = await createConversation();
    const { events, emit } = collect();
    await sendMessage(conversation.id, "please read something", emit);

    expect(events.some((event) => event.type === "assistant_delta")).toBe(true);
    expect(events.some((event) => event.type === "tool_call")).toBe(true);
    expect(events.some((event) => event.type === "tool_result" && event.ok)).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("pauses write tools, exposes the pending call in history, and respects a rejection", async () => {
    const conversation = await createConversation();
    const { events, emit } = collect();
    await sendMessage(conversation.id, "please write something", emit);

    const confirm = events.find(
      (event): event is Extract<AgentEvent, { type: "confirm_request" }> =>
        event.type === "confirm_request",
    );
    expect(confirm).toBeDefined();

    const restored = await history(conversation.id);
    expect(restored.pending?.pendingId).toBe(confirm!.pendingId);
    expect(restored.pending?.name).toBe(confirm!.name);

    const before = calls;
    const after = collect();
    await resolveConfirmation(confirm!.pendingId, false, after.emit);

    expect(calls).toBe(before);
    expect(after.events.some((event) => event.type === "tool_result" && !event.ok)).toBe(true);
    expect(after.events.at(-1)?.type).toBe("done");
    expect((await history(conversation.id)).pending).toBeNull();
  });

  it("executes a write tool exactly once after approval", async () => {
    const conversation = await createConversation();
    const { events, emit } = collect();
    await sendMessage(conversation.id, "please write again", emit);

    const confirm = events.find(
      (event): event is Extract<AgentEvent, { type: "confirm_request" }> =>
        event.type === "confirm_request",
    );
    expect(confirm).toBeDefined();

    const before = calls;
    const after = collect();
    await resolveConfirmation(confirm!.pendingId, true, after.emit);

    expect(calls).toBe(before + 1);
    expect(after.events.some((event) => event.type === "tool_result" && event.ok)).toBe(true);
    expect(after.events.at(-1)?.type).toBe("done");
  });

  it("refuses a second message while a confirmation is pending", async () => {
    const conversation = await createConversation();
    const { emit } = collect();
    await sendMessage(conversation.id, "please write once more", emit);

    await expect(sendMessage(conversation.id, "another one", emit)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("answers every tool_call when a batch pauses on a write", async () => {
    const conversation = await createConversation();
    const { events, emit } = collect();
    await sendMessage(conversation.id, "multi write and read", emit);

    const confirm = events.find(
      (event): event is Extract<AgentEvent, { type: "confirm_request" }> =>
        event.type === "confirm_request",
    );
    expect(confirm).toBeDefined();
    // The read call that came after the write must be answered as skipped.
    expect(events.some((event) => event.type === "tool_result" && !event.ok)).toBe(true);

    await resolveConfirmation(confirm!.pendingId, true, collect().emit);

    const rows = await db.select().from(messages).where(eq(messages.conversationId, conversation.id));
    const assistant = rows.find(
      (row) => row.role === "assistant" && row.content.includes("toolCalls"),
    );
    expect(assistant).toBeDefined();

    const callsAsked = (JSON.parse(assistant!.content) as {
      toolCalls: Array<{ id: string }>;
    }).toolCalls;
    const toolRows = rows
      .filter((row) => row.role === "tool")
      .map((row) => JSON.parse(row.content) as { toolCallId?: string; error?: string });

    for (const call of callsAsked) {
      expect(toolRows.some((row) => row.toolCallId === call.id)).toBe(true);
    }
    expect(toolRows.some((row) => row.error?.startsWith("Skipped"))).toBe(true);
  });
});

describe("system prompt", () => {
  it("defaults, saves and resets", async () => {
    const initial = await getPrompt();
    expect(initial.isDefault).toBe(true);
    expect(initial.systemPrompt.length).toBeGreaterThan(10);

    const saved = await setPrompt("You are a terse assistant.");
    expect(saved.isDefault).toBe(false);
    expect((await getPrompt()).systemPrompt).toBe("You are a terse assistant.");

    const reset = await setPrompt("   ");
    expect(reset.isDefault).toBe(true);
    expect(reset.systemPrompt).toBe(initial.systemPrompt);
  });
});
