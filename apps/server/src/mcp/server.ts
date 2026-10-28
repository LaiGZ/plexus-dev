import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { sha256 } from "../infra/crypto.js";
import { db } from "../infra/db/client.js";
import { sources, tools } from "../infra/db/schema.js";
import { AppError, isAppError } from "../infra/errors.js";
import { logger } from "../infra/logger.js";
import { invokeTool } from "../domain/invoke/pipeline.js";
import type { VerifiedToken } from "../domain/tokens/service.js";

const MAX_RESULT_CHARS = 20_000;

interface McpTool {
  id: string;
  mcpName: string;
  description: string;
  sideEffect: "read" | "write";
  inputSchema: unknown;
}

async function loadExposedTools(scope: "read" | "write", sourceIds: string[]): Promise<McpTool[]> {
  const rows = await db
    .select({ tool: tools, source: sources })
    .from(tools)
    .innerJoin(sources, eq(tools.sourceId, sources.id))
    .where(and(eq(tools.exposed, true), eq(tools.enabled, true), eq(sources.enabled, true)));

  return rows
    .filter((row) => sourceIds.length === 0 || sourceIds.includes(row.source.id))
    .filter((row) => scope === "write" || row.tool.sideEffect !== "write")
    .map((row) => ({
      id: row.tool.id,
      mcpName: row.tool.mcpName,
      description: `${row.tool.description || row.tool.name}\n\n(App: ${row.source.name}; ${
        row.tool.sideEffect === "write" ? "⚠️ modifies data" : "read-only"
      })`,
      sideEffect: row.tool.sideEffect === "write" ? "write" : "read",
      inputSchema: (() => {
        try {
          return JSON.parse(row.tool.inputSchema) as unknown;
        } catch {
          return { type: "object", properties: {} };
        }
      })(),
    }));
}

function preview(value: unknown): { text: string; truncated: boolean } {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  } catch {
    text = String(value);
  }
  if (text.length <= MAX_RESULT_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated, ${text.length} chars total]`,
    truncated: true,
  };
}

function errorText(err: unknown): string {
  if (isAppError(err)) {
    return err.hint ? `${err.message}\n${err.hint}` : err.message;
  }
  return "Tool call failed";
}

function buildServer(token: VerifiedToken, available: McpTool[]): Server {
  const server = new Server(
    { name: "plexus", version: config.version },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools are exposed by this Plexus instance. Calls are attributed to the token owner and recorded in the invocation log. Tools marked as modifying data change state on the upstream system.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: available.map((tool) => ({
      name: tool.mcpName,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: "object"; [key: string]: unknown },
      annotations: {
        readOnlyHint: tool.sideEffect === "read",
        destructiveHint: tool.sideEffect === "write",
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = available.find((candidate) => candidate.mcpName === name);
    if (!tool) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${name}. Call tools/list to see what this token can use.`,
          },
        ],
        isError: true,
      };
    }

    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const explicitKey = typeof args["idempotencyKey"] === "string" ? args["idempotencyKey"] : undefined;
    if (explicitKey) delete args["idempotencyKey"];

    const idempotencyKey =
      explicitKey ??
      `mcp:${sha256(`${token.id}|${tool.mcpName}|${JSON.stringify(args)}`)}`;

    try {
      const result = await invokeTool({
        toolId: tool.id,
        args,
        via: "mcp",
        scope: token.scope,
        tokenId: token.id,
        idempotencyKey,
      });
      const { text, truncated } = preview(result.data);
      const structured =
        !truncated && typeof result.data === "object" && result.data !== null && !Array.isArray(result.data)
          ? (result.data as Record<string, unknown>)
          : undefined;

      return {
        content: [{ type: "text" as const, text }],
        ...(structured ? { structuredContent: structured } : {}),
        isError: false,
      };
    } catch (err) {
      if (err instanceof AppError && err.code === "read_only_token") {
        return {
          content: [
            {
              type: "text" as const,
              text: "This token is read-only. Create a token with scope=write to call modifying tools.",
            },
          ],
          isError: true,
        };
      }
      logger.warn({ tool: tool.mcpName, err }, "mcp tool call failed");
      return {
        content: [{ type: "text" as const, text: errorText(err) }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Handle one stateless Streamable HTTP request.
 *
 * A fresh server + transport per request keeps the lifecycle trivial: no session
 * table, no in-memory state to leak, and tool changes take effect immediately.
 */
export async function handleMcpRequest(
  request: Request,
  token: VerifiedToken,
): Promise<Response> {
  const available = await loadExposedTools(token.scope, token.sourceIds);
  const server = buildServer(token, available);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
