import { z } from "zod";
import { Id, IsoDate, Scope } from "./common.js";

export const SourceKind = z.enum(["openapi", "http", "mcp"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const AuthInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string().min(1).max(4096) }),
  z.object({
    type: z.literal("basic"),
    username: z.string().min(1).max(256),
    password: z.string().max(4096).default(""),
  }),
  z.object({
    type: z.literal("header"),
    headerName: z.string().min(1).max(128),
    headerValue: z.string().max(4096),
  }),
]);
export type AuthInput = z.infer<typeof AuthInput>;

export const HttpMethod = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/);

export const ToolDraft = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().max(2000).default(""),
  method: HttpMethod.default("POST"),
  path: z.string().min(1).max(500),
  sideEffect: Scope.default("read"),
  inputSchema: z.unknown().optional(),
  /** Per-method exposure; falls back to the request-level `exposeAll`. */
  exposed: z.boolean().optional(),
});
export type ToolDraft = z.infer<typeof ToolDraft>;

export const PreviewOpenApiInput = z.object({
  kind: z.literal("openapi"),
  name: z.string().trim().min(1).max(64).optional(),
  specUrl: z.string().url().optional(),
  specText: z.string().min(1).max(2_000_000).optional(),
  baseUrl: z.string().url().optional(),
  auth: AuthInput.default({ type: "none" }),
  headers: z.record(z.string().max(1024)).default({}),
});

export const PreviewHttpInput = z.object({
  kind: z.literal("http"),
  name: z.string().trim().min(1).max(64).default("Custom API"),
  baseUrl: z.string().url(),
  tools: z.array(ToolDraft).min(1).max(100),
});

export const PreviewMcpInput = z.object({
  kind: z.literal("mcp"),
  name: z.string().trim().min(1).max(64).optional(),
  baseUrl: z.string().url(),
  auth: AuthInput.default({ type: "none" }),
  headers: z.record(z.string().max(1024)).default({}),
});

export const PreviewSourceInput = z.discriminatedUnion("kind", [
  PreviewOpenApiInput,
  PreviewHttpInput,
  PreviewMcpInput,
]);
export type PreviewSourceInput = z.infer<typeof PreviewSourceInput>;

export const ToolPreview = z.object({
  name: z.string(),
  mcpName: z.string(),
  description: z.string(),
  method: z.string(),
  path: z.string(),
  sideEffect: Scope,
  inputSchema: z.unknown(),
  exposed: z.boolean().optional(),
});
export type ToolPreview = z.infer<typeof ToolPreview>;

export const PreviewResult = z.object({
  baseUrl: z.string(),
  tools: z.array(ToolPreview),
  warnings: z.array(z.string()),
});
export type PreviewResult = z.infer<typeof PreviewResult>;

export const CreateSourceInput = z.object({
  name: z.string().trim().min(1).max(64),
  kind: SourceKind,
  baseUrl: z.string().url(),
  auth: AuthInput.default({ type: "none" }),
  headers: z.record(z.string().max(1024)).default({}),
  tools: z.array(ToolDraft).min(1).max(100),
  /** Expose every created method to the platform (assistant/MCP) right away. */
  exposeAll: z.boolean().default(false),
});
export type CreateSourceInput = z.infer<typeof CreateSourceInput>;

export const UpdateSourceInput = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  auth: AuthInput.optional(),
  headers: z.record(z.string().max(1024)).optional(),
});
export type UpdateSourceInput = z.infer<typeof UpdateSourceInput>;

export const UpdateToolInput = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  method: HttpMethod.optional(),
  path: z.string().min(1).max(500).optional(),
  exposed: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sideEffect: Scope.optional(),
  description: z.string().max(2000).optional(),
  inputSchema: z.unknown().optional(),
});
export type UpdateToolInput = z.infer<typeof UpdateToolInput>;

export const AddToolInput = z.object({
  name: z.string().trim().min(1).max(64),
  method: HttpMethod.default("POST"),
  path: z.string().min(1).max(500).default("/"),
  description: z.string().max(2000).default(""),
  sideEffect: Scope.default("read"),
  inputSchema: z.unknown().optional(),
  exposed: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type AddToolInput = z.infer<typeof AddToolInput>;

export const AppExportTool = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().max(2000).default(""),
  method: HttpMethod.default("POST"),
  path: z.string().min(1).max(500).default("/"),
  sideEffect: Scope.default("read"),
  inputSchema: z.unknown().optional(),
  exposed: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type AppExportTool = z.infer<typeof AppExportTool>;

/** Portable app configuration. Never contains credentials or secrets. */
export const AppExport = z.object({
  format: z.literal("plexus.app.v1"),
  exportedAt: IsoDate.optional(),
  app: z.object({
    id: Id,
    name: z.string().min(1).max(64),
    kind: SourceKind,
    baseUrl: z.string().url(),
  }),
  tools: z.array(AppExportTool).min(1).max(200),
});
export type AppExport = z.infer<typeof AppExport>;

export const ImportPreviewInput = z.object({
  text: z.string().min(1).max(2_000_000),
});
export type ImportPreviewInput = z.infer<typeof ImportPreviewInput>;

export const ImportDiff = z.object({
  appId: Id,
  nameChange: z.object({ from: z.string(), to: z.string() }).nullable(),
  baseUrlChange: z.object({ from: z.string(), to: z.string() }).nullable(),
  added: z.array(ToolPreview),
  updated: z.array(
    z.object({ id: Id, name: z.string(), fields: z.array(z.string()) }),
  ),
  removed: z.array(z.object({ id: Id, name: z.string() })),
  warnings: z.array(z.string()),
});
export type ImportDiff = z.infer<typeof ImportDiff>;

export const ImportApplyInput = z.object({
  text: z.string().min(1).max(2_000_000),
  /** Delete methods that exist locally but not in the file. */
  removeMissing: z.boolean().default(false),
});
export type ImportApplyInput = z.infer<typeof ImportApplyInput>;

export const ImportApplyResult = z.object({
  created: z.number(),
  updated: z.number(),
  removed: z.number(),
});
export type ImportApplyResult = z.infer<typeof ImportApplyResult>;

/** Creation template: no app id — the platform generates it. */
export const AppTemplate = z.object({
  format: z.literal("plexus.template.v1"),
  app: z.object({
    name: z.string().trim().min(1).max(64),
    baseUrl: z.string().url(),
    auth: AuthInput.optional(),
    headers: z.record(z.string()).optional(),
  }),
  tools: z.array(AppExportTool).min(1).max(200),
});
export type AppTemplate = z.infer<typeof AppTemplate>;

export const TemplatePreviewInput = z.object({
  text: z.string().min(1).max(2_000_000),
});
export type TemplatePreviewInput = z.infer<typeof TemplatePreviewInput>;

export const TemplatePreview = z.object({
  app: z.object({
    name: z.string(),
    baseUrl: z.string(),
    auth: AuthInput.optional(),
    headers: z.record(z.string()).optional(),
  }),
  tools: z.array(ToolPreview),
  warnings: z.array(z.string()),
});
export type TemplatePreview = z.infer<typeof TemplatePreview>;

export const SourceSummary = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  kind: SourceKind,
  baseUrl: z.string(),
  enabled: z.boolean(),
  authType: z.string(),
  toolCount: z.number(),
  exposedCount: z.number(),
  lastInvokedAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type SourceSummary = z.infer<typeof SourceSummary>;

export const ToolSummary = z.object({
  id: Id,
  sourceId: Id,
  sourceName: z.string(),
  /** Human-facing `app.tool` form (dots); MCP clients still use `mcpName`. */
  displayName: z.string(),
  name: z.string(),
  mcpName: z.string(),
  description: z.string(),
  method: z.string(),
  path: z.string(),
  sideEffect: Scope,
  exposed: z.boolean(),
  enabled: z.boolean(),
  inputSchema: z.unknown(),
});
export type ToolSummary = z.infer<typeof ToolSummary>;

export const SourceDetail = z.object({
  source: SourceSummary,
  tools: z.array(ToolSummary),
});
export type SourceDetail = z.infer<typeof SourceDetail>;

export const SourceList = z.object({ sources: z.array(SourceSummary) });
export const ToolList = z.object({ tools: z.array(ToolSummary) });
export type SourceList = z.infer<typeof SourceList>;
export type ToolList = z.infer<typeof ToolList>;

export const AppGrantsInput = z.object({
  toolIds: z.array(z.string().min(1)).max(500),
});
export type AppGrantsInput = z.infer<typeof AppGrantsInput>;

export const AppGrantsResult = z.object({ toolIds: z.array(z.string()) });
export type AppGrantsResult = z.infer<typeof AppGrantsResult>;

export const ToolUsage = z.object({
  grantedApps: z.array(z.object({ id: Id, name: z.string() })),
  exposed: z.boolean(),
  invocationCount: z.number(),
  lastInvokedAt: IsoDate.nullable(),
});
export type ToolUsage = z.infer<typeof ToolUsage>;

export const StatsResponse = z.object({
  sources: z.number(),
  tools: z.number(),
  exposedTools: z.number(),
  tokens: z.number(),
  invocationsToday: z.number(),
  errorsToday: z.number(),
});
export type StatsResponse = z.infer<typeof StatsResponse>;
