import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Single-tenant design: exactly one role row (`super_admin`) and one user row. */
export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  /** JSON string array. `["*"]` means everything. */
  permissions: text("permissions").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("active"),
  /** True after an auto-generated password, until the owner changes it. */
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(false),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** sha256(token) — the raw token only ever lives in the cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * A source is an upstream API: one base URL plus the tools discovered on it.
 * Credentials are stored encrypted (`auth_enc`), never returned by the API.
 */
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  kind: text("kind").notNull(), // openapi | http
  baseUrl: text("base_url").notNull(),
  /** Normalized import result (JSON), useful for re-import and debugging. */
  spec: text("spec"),
  authType: text("auth_type").notNull().default("none"), // none | bearer | basic | header
  authEnc: text("auth_enc"),
  /** Extra headers as a JSON object of strings. */
  headers: text("headers").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Secret for app-to-app calls via /gateway/invoke (hash only). */
  appSecretHash: text("app_secret_hash"),
  appSecretPrefix: text("app_secret_prefix"),
  appSecretCreatedAt: integer("app_secret_created_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const tools = sqliteTable(
  "tools",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Name as it appears in the source (e.g. an OpenAPI operationId). */
    name: text("name").notNull(),
    /** Stable, MCP-safe name: `{source_slug}__{tool}`. */
    mcpName: text("mcp_name").notNull().unique(),
    description: text("description").notNull().default(""),
    /** JSON Schema for the tool arguments. */
    inputSchema: text("input_schema").notNull().default('{"type":"object","properties":{}}'),
    method: text("method").notNull().default("POST"),
    /** Path template relative to the source base URL (may contain `{param}`). */
    path: text("path").notNull().default("/"),
    sideEffect: text("side_effect").notNull().default("read"), // read | write
    idempotent: integer("idempotent", { mode: "boolean" }).notNull().default(false),
    exposed: integer("exposed", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("tools_source_name_idx").on(table.sourceId, table.name)],
);

/** Bearer credentials for `/mcp`. Only the hash is stored. */
export const tokens = sqliteTable(
  "tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    scope: text("scope").notNull().default("read"), // read | write
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("tokens_hash_idx").on(table.hash)],
);

/** Per-token app restriction. No rows means "all apps". */
export const tokenApps = sqliteTable(  "token_apps",
  {
    tokenId: text("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.tokenId, table.sourceId] })],
);

/** Which tools an app may call through /gateway/invoke. */
export const appGrants = sqliteTable(
  "app_grants",
  {
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    toolId: text("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.toolId] })],
);

/** Short-lived tokens obtained by an app exchanging its app secret. */
export const serviceTokens = sqliteTable(
  "service_tokens",
  {
    /** sha256(token) */
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("service_tokens_source_idx").on(table.sourceId)],
);

/** One row per invocation. Denormalized on purpose: logs outlive the tool. */
export const invocations = sqliteTable(
  "invocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    toolId: text("tool_id"),
    toolName: text("tool_name"),
    sourceId: text("source_id"),
    tokenId: text("token_id"),
    /** user | mcp | app */
    actorType: text("actor_type"),
    actorId: text("actor_id"),
    via: text("via").notNull().default("api"), // try | mcp | agent | gateway-app
    status: text("status").notNull(), // ok | error | replayed
    latencyMs: integer("latency_ms"),
    requestPreview: text("request_preview"),
    responsePreview: text("response_preview"),
    errorCode: text("error_code"),
    requestId: text("request_id"),
  },
  (table) => [
    index("invocations_ts_idx").on(table.ts),
    index("invocations_tool_idx").on(table.toolId),
  ],
);

/** Three-state idempotency ledger for write tools. */
export const idempotencyRecords = sqliteTable(  "idempotency_records",
  {
    id: text("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    keyHash: text("key_hash").notNull(),
    requestDigest: text("request_digest").notNull(),
    state: text("state").notNull(), // in_progress | done | failed
    responseRef: text("response_ref"),
    leaseUntil: integer("lease_until", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("idempotency_scope_key_idx").on(table.scopeKey, table.keyHash)],
);

/** The built-in assistant uses a single conversation per instance. */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New conversation"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | tool
    /** JSON: { text } for chat, { toolCallId, name, result } for tool results. */
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId, table.id)],
);

/** A write tool call waiting for the owner to approve or reject it. */
export const pendingToolCalls = sqliteTable(
  "pending_tool_calls",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull(),
    toolName: text("tool_name").notNull(),
    /** The model's tool_call id, so the result can be stitched back into the thread. */
    toolCallId: text("tool_call_id").notNull().default(""),
    args: text("args").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("pending_tool_calls_status_idx").on(table.status)],
);

export type Role = typeof roles.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Tool = typeof tools.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type Invocation = typeof invocations.$inferSelect;
export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type PendingToolCall = typeof pendingToolCalls.$inferSelect;
export type TokenApp = typeof tokenApps.$inferSelect;
export type ServiceToken = typeof serviceTokens.$inferSelect;
export type AppGrant = typeof appGrants.$inferSelect;
