import type { AuthInput, PreviewResult, PreviewSourceInput } from "@plexus/contracts";
import { config } from "../../config.js";
import { badRequest } from "../../infra/errors.js";
import { fetchUpstream } from "../../infra/upstream.js";
import { listMcpTools, type RemoteTool } from "./mcp.js";
import { parseOpenApi } from "./openapi.js";
import { draftToPreview, mcpNameFor, slugify } from "./service.js";
import type { AuthConfig } from "../invoke/request-builder.js";

function slugFromUrl(url: string): string {
  try {
    return slugify(new URL(url).hostname);
  } catch {
    return "api";
  }
}

async function previewMcp(input: {
  name?: string;
  baseUrl: string;
  auth: AuthInput;
}): Promise<PreviewResult> {
  const auth = input.auth.type === "none" ? null : (input.auth as AuthConfig);
  const slug = slugify(input.name ?? slugFromUrl(input.baseUrl));
  const remote = await listMcpTools(input.baseUrl, auth);
  const taken = new Set<string>();

  return {
    baseUrl: input.baseUrl,
    tools: remote.map((tool: RemoteTool) => ({
      name: tool.name,
      mcpName: mcpNameFor(slug, tool.name, taken),
      description: tool.description,
      // Remote MCP tools are addressed by name, not by HTTP method/path.
      method: "POST",
      path: "/",
      sideEffect: tool.sideEffect,
      inputSchema: tool.inputSchema,
    })),
    warnings: [],
  };
}

/**
 * Dry-run import: fetch and parse, but never persist. The client then posts the
 * tools it selected, so a preview cannot silently create half-configured sources.
 */
export async function previewSource(input: PreviewSourceInput): Promise<PreviewResult> {
  if (input.kind === "http") {
    const slug = slugify(input.name);
    const taken = new Set<string>();
    return {
      baseUrl: input.baseUrl,
      tools: input.tools.map((draft) => draftToPreview(slug, draft, taken)),
      warnings: [],
    };
  }

  if (input.kind === "mcp") {
    return previewMcp({ name: input.name, baseUrl: input.baseUrl, auth: input.auth });
  }

  let text = input.specText;
  if (!text && input.specUrl) {
    const res = await fetchUpstream({
      url: input.specUrl,
      method: "GET",
      headers: {
        accept: "application/json, application/yaml, text/yaml, */*",
        ...input.headers,
      },
      timeoutMs: config.upstreamTimeoutMs,
    });
    if (!res.ok) {
      throw badRequest(
        `Could not fetch the spec (HTTP ${res.status})`,
        undefined,
        "Check the URL, or paste the spec text instead",
      );
    }
    text = res.text;
  }
  if (!text) throw badRequest("Provide specUrl or specText");

  const slug = slugify(input.name ?? slugFromUrl(input.baseUrl ?? input.specUrl ?? "api"));
  const parsed = parseOpenApi(text, {
    baseUrl: input.baseUrl,
    mcpNames: (name) => `${slug}__${name}`.slice(0, 64),
  });

  return { baseUrl: parsed.baseUrl, tools: parsed.tools, warnings: parsed.warnings };
}
