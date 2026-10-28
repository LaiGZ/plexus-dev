import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../../config.js";
import { decryptJson } from "../../infra/crypto.js";
import { assertEgressAllowed } from "../../infra/egress.js";
import { upstreamTimeout, upstreamUnreachable } from "../../infra/errors.js";
import type { AuthConfig } from "../invoke/request-builder.js";

function authHeaders(auth: AuthConfig | null): Record<string, string> {
  if (!auth || auth.type === "none") return {};
  if (auth.type === "bearer" && auth.token) return { authorization: `Bearer ${auth.token}` };
  if (auth.type === "basic" && auth.username !== undefined) {
    const raw = `${auth.username}:${auth.password ?? ""}`;
    return { authorization: `Basic ${Buffer.from(raw, "utf8").toString("base64")}` };
  }
  if (auth.type === "header" && auth.headerName) return { [auth.headerName]: auth.headerValue ?? "" };
  return {};
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(upstreamTimeout()), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function withClient<T>(
  baseUrl: string,
  auth: AuthConfig | null,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  await assertEgressAllowed(baseUrl);

  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: authHeaders(auth) },
  });
  const client = new Client({ name: "plexus", version: config.version });

  try {
    await withTimeout(client.connect(transport), config.upstreamTimeoutMs);
    return await run(client);
  } catch (err) {
    if (err instanceof Error && err.name === "AppError") throw err;
    if (typeof err === "object" && err !== null && "code" in err) throw err;
    throw upstreamUnreachable(
      err instanceof Error ? err.message : "Could not talk to the MCP server",
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function mcpAuthFor(authEnc: string | null): AuthConfig | null {
  return authEnc ? decryptJson<AuthConfig>(authEnc, config.dataKey) : null;
}

export interface RemoteTool {
  name: string;
  description: string;
  inputSchema: unknown;
  sideEffect: "read" | "write";
}

export async function listMcpTools(
  baseUrl: string,
  auth: AuthConfig | null,
): Promise<RemoteTool[]> {
  const result = await withClient(baseUrl, auth, (client) => client.listTools());
  return result.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? tool.name,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    // Conservative: only remote tools that explicitly declare readOnlyHint are reads.
    sideEffect: tool.annotations?.readOnlyHint === true ? "read" : "write",
  }));
}

function resultToData(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (structured !== undefined) return structured;

  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n");

  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function callMcpTool(
  baseUrl: string,
  auth: AuthConfig | null,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await withClient(baseUrl, auth, (client) =>
    client.callTool({ name, arguments: args }),
  );

  if ((result as { isError?: boolean }).isError) {
    const text = ((result as { content?: Array<{ text?: string }> }).content ?? [])
      .map((part) => part.text ?? "")
      .join("\n");
    throw upstreamUnreachable(text || "The remote MCP tool returned an error");
  }

  return resultToData(result);
}
