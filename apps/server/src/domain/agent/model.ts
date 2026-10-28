import type {
  AgentModelConfig,
  ModelProvider,
  TestModelResult,
  UpdateAgentModelInput,
} from "@plexus/contracts";
import { config } from "../../config.js";
import { decryptJson, encryptJson } from "../../infra/crypto.js";
import { upstreamError, upstreamTimeout, upstreamUnreachable } from "../../infra/errors.js";
import { getSetting, setSetting } from "../settings/service.js";

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelTool {
  name: string;
  description: string;
  parameters: unknown;
  /** Not sent to the provider; used by the stub to pick a realistic call. */
  sideEffect: "read" | "write";
}

export interface ModelReply {
  text: string;
  toolCalls: ModelToolCall[];
}

export interface ModelStatus {
  enabled: boolean;
  provider: string;
  model: string;
  reason?: string;
}

const SETTING_KEY = "agent.model";

const DEFAULTS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  stub: { baseUrl: "", model: "stub" },
} as const;

interface StoredModel {
  provider?: ModelProvider;
  baseUrl?: string;
  name?: string;
  apiKeyEnc?: string;
  timeoutMs?: number;
}

async function loadStored(): Promise<StoredModel | null> {
  const raw = await getSetting(SETTING_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as StoredModel) : null;
  } catch {
    return null;
  }
}

export interface ResolvedModel {
  provider: ModelProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  source: "db" | "env" | "default";
}

/** DB override wins, then environment, then provider defaults. */
export async function resolveModel(): Promise<ResolvedModel> {
  const stored = await loadStored();
  const provider = stored?.provider ?? config.model.provider;
  const defaults = DEFAULTS[provider];
  const envApplies = provider === config.model.provider;

  const storedKey = stored?.apiKeyEnc
    ? decryptJson<string>(stored.apiKeyEnc, config.dataKey)
    : null;
  const envKey = envApplies ? (config.model.apiKey ?? "") : "";
  const apiKey = storedKey || envKey || "";

  const envConfigured = Boolean(config.model.apiKey || config.model.baseUrl || config.model.name);

  return {
    provider,
    baseUrl: (stored?.baseUrl ?? (envApplies ? config.model.baseUrl : undefined) ?? defaults.baseUrl)
      .replace(/\/+$/, ""),
    model: stored?.name ?? (envApplies ? config.model.name : undefined) ?? defaults.model,
    apiKey,
    timeoutMs: stored?.timeoutMs ?? config.model.timeoutMs,
    source: stored ? "db" : envConfigured ? "env" : "default",
  };
}

export async function modelStatus(): Promise<ModelStatus> {
  const model = await resolveModel();
  if (model.provider === "stub") {
    return {
      enabled: true,
      provider: model.provider,
      model: model.model,
      reason: "Stub provider: answers are deterministic",
    };
  }
  if (!model.apiKey) {
    return {
      enabled: false,
      provider: model.provider,
      model: model.model,
      reason: `No API key configured (provider: ${model.provider})`,
    };
  }
  return { enabled: true, provider: model.provider, model: model.model };
}

export async function getModelConfig(): Promise<AgentModelConfig> {
  const model = await resolveModel();
  const status = await modelStatus();
  return {
    provider: model.provider,
    baseUrl: model.baseUrl,
    model: model.model,
    timeoutMs: model.timeoutMs,
    hasKey: Boolean(model.apiKey),
    keyHint: model.apiKey ? `••••${model.apiKey.slice(-4)}` : null,
    source: model.source,
    enabled: status.enabled,
  };
}

export async function saveModelConfig(input: UpdateAgentModelInput): Promise<AgentModelConfig> {
  const stored = await loadStored();
  const provider = input.provider;

  let apiKeyEnc = stored?.apiKeyEnc;
  if (input.apiKey !== undefined) {
    apiKeyEnc = input.apiKey.trim()
      ? encryptJson(input.apiKey.trim(), config.dataKey)
      : undefined;
  }

  const next: StoredModel = {
    provider,
    baseUrl: input.baseUrl?.trim() || undefined,
    name: input.model.trim(),
    timeoutMs: input.timeoutMs,
    ...(apiKeyEnc ? { apiKeyEnc } : {}),
  };
  await setSetting(SETTING_KEY, JSON.stringify(next));
  return getModelConfig();
}

function headerJson(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

async function parseError(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  throw upstreamError(res.status, headerJson(text));
}

/**
 * OpenAI-compatible chat completion.
 *
 * - Streams text deltas through `onDelta` and accumulates tool-call fragments.
 * - No empty `tools` array (rejected by some providers).
 * - DeepSeek thinking mode disabled by default (slow and ignores tool_choice).
 */
export async function chat(
  messages: ModelMessage[],
  tools: ModelTool[],
  onDelta?: (text: string) => void | Promise<void>,
): Promise<ModelReply> {
  const model = await resolveModel();

  if (model.provider === "stub") {
    const reply = stubReply(messages, tools);
    if (reply.text && onDelta) await onDelta(reply.text);
    return reply;
  }
  if (!model.apiKey) throw new Error("No API key configured for the assistant");

  const body: Record<string, unknown> = {
    model: model.model,
    stream: true,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    })),
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    body.tool_choice = "auto";
  }

  if (model.provider === "deepseek") {
    body.thinking = { type: "disabled" };
  }

  let res: Response;
  try {
    res = await fetch(`${model.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(model.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw upstreamTimeout();
    }
    throw upstreamUnreachable("Could not reach the model provider");
  }

  if (!res.ok) await parseError(res);
  if (!res.body) throw upstreamUnreachable("The model provider returned an empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!payload || payload === "[DONE]") continue;

      let json: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        json = JSON.parse(payload) as typeof json;
      } catch {
        continue;
      }

      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        if (onDelta) await onDelta(delta.content);
      }

      for (const fragment of delta.tool_calls ?? []) {
        const index = fragment.index ?? 0;
        const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (fragment.id) current.id = fragment.id;
        if (fragment.function?.name) current.name += fragment.function.name;
        if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
        calls.set(index, current);
      }
    }
  }

  return {
    text,
    toolCalls: [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, call]) => call.name)
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments || "{}",
      })),
  };
}

export async function testModel(): Promise<TestModelResult> {
  const started = Date.now();
  try {
    const reply = await chat(
      [{ role: "user", content: "Reply with the single word: pong" }],
      [],
    );
    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: reply.text.trim().slice(0, 80) || "ok",
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : "Model call failed",
    };
  }
}

function stubReply(messages: ModelMessage[], tools: ModelTool[]): ModelReply {
  const last = messages.at(-1);
  if (!last) return { text: "No input.", toolCalls: [] };

  if (last.role === "tool") {
    return { text: `Stub finished: ${last.content.slice(0, 200)}`, toolCalls: [] };
  }

  const wantsWrite = /write|create|bump|修改|写/i.test(last.content);
  const wantsMulti = /multi/i.test(last.content);

  function callFor(tool: ModelTool, suffix: string): ModelToolCall {
    const parameters = tool.parameters as {
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    const args: Record<string, unknown> = {};
    for (const key of parameters?.required ?? []) {
      const type = parameters.properties?.[key]?.type;
      args[key] =
        type === "number" || type === "integer" ? 1 : type === "boolean" ? false : `stub ${key}`;
    }
    return {
      id: `stub_${Date.now()}_${suffix}`,
      name: tool.name,
      arguments: JSON.stringify(args),
    };
  }

  if (wantsMulti) {
    const writeTool = tools.find((tool) => tool.sideEffect === "write");
    const readTool = tools.find((tool) => tool.sideEffect === "read");
    if (writeTool && readTool) {
      return { text: "", toolCalls: [callFor(writeTool, "w"), callFor(readTool, "r")] };
    }
  }

  if (tools.length === 0) {
    const pong = /pong|ping/i.test(last.content);
    return { text: pong ? "pong" : "No tools are available.", toolCalls: [] };
  }

  const candidate =
    tools.find((tool) => (wantsWrite ? tool.sideEffect === "write" : tool.sideEffect === "read")) ??
    tools[0];

  if (!candidate) {
    return { text: "No tools are available, so I cannot do that.", toolCalls: [] };
  }

  return { text: "", toolCalls: [callFor(candidate, "single")] };
}
