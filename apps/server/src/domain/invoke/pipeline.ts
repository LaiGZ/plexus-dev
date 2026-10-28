import { randomUUID } from "node:crypto";
import type { Scope } from "@plexus/contracts";
import { eq } from "drizzle-orm";
import { config } from "../../config.js";
import { decryptJson } from "../../infra/crypto.js";
import { db } from "../../infra/db/client.js";
import { sources, tools, type Source, type Tool } from "../../infra/db/schema.js";
import {
  AppError,
  badRequest,
  isAppError,
  notFound,
  readOnlyToken,
  upstreamError,
} from "../../infra/errors.js";
import { logger } from "../../infra/logger.js";
import { fetchUpstream } from "../../infra/upstream.js";
import { recordInvocation, type InvocationRecord } from "../invocations/service.js";
import { callMcpTool, mcpAuthFor } from "../source/mcp.js";
import {
  beginIdempotency,
  completeIdempotency,
  digestArgs,
  failIdempotency,
} from "./idempotency.js";
import { takeRateLimitToken } from "./rate-limit.js";
import { buildUpstreamRequest, type AuthConfig } from "./request-builder.js";
import { validateToolArgs } from "./validate-args.js";

export interface InvokeInput {
  toolId: string;
  args: Record<string, unknown>;
  via: "try" | "mcp" | "agent" | "api" | "gateway-app";
  scope: Scope;
  tokenId?: string | null;
  idempotencyKey?: string;
  /** Try-it calls must be able to hit a tool before it is exposed. */
  allowUnexposed?: boolean;
  requestId?: string | null;
  /** Attribution for the invocation log. */
  actorType?: "user" | "mcp" | "app" | "agent";
  actorId?: string | null;
}

export interface InvokeOutput {
  ok: true;
  data: unknown;
  traceId: string;
  latencyMs: number;
  replayed?: boolean;
}

function preview(value: unknown, max = 2_000): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…(+${text.length - max} chars)` : text;
}

function parseBody(text: string, contentType: string | undefined): unknown {
  if (!text) return null;
  const looksJson = contentType?.includes("json") || /^[[{]/.test(text.trim());
  if (!looksJson) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function loadTool(
  toolId: string,
): Promise<{ tool: Tool; source: Source } | null> {
  const row = (
    await db
      .select({ tool: tools, source: sources })
      .from(tools)
      .innerJoin(sources, eq(tools.sourceId, sources.id))
      .where(eq(tools.id, toolId))
      .limit(1)
  )[0];
  return row ?? null;
}

/**
 * The single path every tool call takes. Steps are explicit and ordered so each
 * one can be tested in isolation and reasoned about in review:
 *
 *   load → scope → rate limit → validate → idempotency → forward → log
 */
export async function invokeTool(input: InvokeInput): Promise<InvokeOutput> {
  const started = Date.now();
  const traceId = input.requestId ?? randomUUID();

  const record: InvocationRecord = {
    toolId: input.toolId,
    toolName: null,
    sourceId: null,
    tokenId: input.tokenId ?? null,
    actorType:
      input.actorType ??
      (input.via === "mcp" ? "mcp" : input.via === "agent" ? "agent" : "user"),
    actorId: input.actorId ?? input.tokenId ?? null,
    via: input.via,
    status: "error",
    latencyMs: null,
    requestPreview: preview(input.args),
    responsePreview: null,
    errorCode: null,
    requestId: traceId,
  };

  try {
    const loaded = await loadTool(input.toolId);
    if (!loaded) throw notFound("Tool not found");
    const { tool, source } = loaded;
    record.toolName = tool.name;
    record.sourceId = source.id;

    if (!source.enabled) {
      throw new AppError("source_disabled", 409, "This source is disabled");
    }
    if (!tool.enabled) throw notFound("Tool is disabled");
    if (!tool.exposed && !input.allowUnexposed) {
      throw new AppError(
        "tool_not_exposed",
        404,
        "This tool is not exposed to MCP",
        "Enable it on the source page first",
      );
    }

    if (tool.sideEffect === "write" && input.scope !== "write") throw readOnlyToken();

    takeRateLimitToken(`${input.tokenId ?? "user"}:${tool.id}`);

    validateToolArgs(tool.inputSchema, input.args);

    const needsIdempotency = tool.sideEffect === "write" || tool.idempotent;
    if (needsIdempotency && !input.idempotencyKey) {
      throw badRequest(
        "Write tools require an idempotency key",
        undefined,
        "Send idempotencyKey (min 8 chars); MCP clients derive one automatically",
      );
    }

    let idempotencyId: string | null = null;
    if (needsIdempotency && input.idempotencyKey) {
      const begun = await beginIdempotency(
        `${input.tokenId ?? "user"}:${tool.id}`,
        input.idempotencyKey,
        digestArgs(input.args),
      );
      if (!begun.proceed) {
        record.status = "replayed";
        record.responsePreview = preview(begun.response);
        record.latencyMs = Date.now() - started;
        return {
          ok: true,
          data: begun.response,
          traceId,
          latencyMs: record.latencyMs,
          replayed: true,
        };
      }
      idempotencyId = begun.id;
    }

    let data: unknown;
    try {
      if (source.kind === "mcp") {
        data = await callMcpTool(
          source.baseUrl,
          mcpAuthFor(source.authEnc),
          tool.name,
          input.args,
        );
      } else {
        const auth = source.authEnc
          ? decryptJson<AuthConfig>(source.authEnc, config.dataKey)
          : null;

        const built = buildUpstreamRequest({
          baseUrl: source.baseUrl,
          method: tool.method,
          path: tool.path,
          args: input.args,
          headers: source.headers,
          auth,
        });

        const res = await fetchUpstream({
          ...built,
          timeoutMs: config.upstreamTimeoutMs,
        });
        if (!res.ok) {
          throw upstreamError(res.status, res.text.slice(0, 300));
        }
        data = parseBody(res.text, res.headers["content-type"]);
      }

      if (idempotencyId) await completeIdempotency(idempotencyId, data);

      record.status = "ok";
      record.responsePreview = preview(data);
      record.latencyMs = Date.now() - started;
      return { ok: true, data, traceId, latencyMs: record.latencyMs };
    } catch (err) {
      if (idempotencyId) await failIdempotency(idempotencyId).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    record.status = "error";
    record.errorCode = isAppError(err) ? err.code : "internal";
    logger.warn(
      { toolId: input.toolId, code: record.errorCode, traceId },
      "tool invocation failed",
    );
    throw err;
  } finally {
    record.latencyMs = record.latencyMs ?? Date.now() - started;
    await recordInvocation(record);
  }
}
