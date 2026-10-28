import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Package root, regardless of dev (src/) or build (dist/). */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Load `.env` from cwd or the package root, without overriding real env vars. */
function loadDotEnv(): void {
  if (process.env.NODE_ENV === "test") return;
  const candidates = [resolve(process.cwd(), ".env"), resolve(packageRoot, ".env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      // ignore malformed env files; schema validation below reports real problems
    }
    return;
  }
}

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default("./data"),
  DATABASE_FILE: z.string().min(1).optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  PUBLIC_URL: z.string().url().optional(),
  PLEXUS_ADMIN_USERNAME: z.string().min(1).default("plexus"),
  PLEXUS_ADMIN_PASSWORD: z.string().min(8).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  COOKIE_SECURE: booleanish.default("false"),
  TRUST_PROXY: booleanish.default("false"),
  PLEXUS_DATA_KEY: z.string().optional(),
  PLEXUS_VERSION: z.string().default("0.1.0"),
  /** Outbound request timeout for gateway calls. */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  /** Hosts allowed to resolve to private addresses (local dev upstreams). */
  EGRESS_ALLOW_HOSTS: z.string().default("127.0.0.1,localhost"),
  /** Per token/tool request budget, per second. */
  RATE_LIMIT_PER_SEC: z.coerce.number().int().min(1).max(1000).default(20),
  /** Days to keep invocation logs. */
  INVOCATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),

  // ── Admin MCP (management endpoint) ───────────────────────────────────
  /** Enables POST /admin/mcp. Unset = endpoint disabled. */
  ADMIN_MCP_TOKEN: z.string().min(16).optional(),

  // ── Built-in assistant ────────────────────────────────────────────────
  MODEL_PROVIDER: z.enum(["deepseek", "openai", "stub"]).default("deepseek"),
  MODEL_API_KEY: z.string().optional(),
  MODEL_BASE_URL: z.string().url().optional(),
  MODEL_NAME: z.string().optional(),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(120_000),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(6),
});

export type Config = {
  isProd: boolean;
  host: string;
  port: number;
  dataDir: string;
  databaseFile: string;
  /** libsql URL: `:memory:` or `file:/abs/path`. */
  databaseUrl: string;
  logLevel: string;
  publicUrl: string;
  adminUsername: string;
  adminPassword?: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  /** Key material for encrypting per-source credentials at rest. */
  dataKey: Buffer;
  version: string;
  webDist: string | null;
  upstreamTimeoutMs: number;
  egressAllowHosts: string[];
  rateLimitPerSec: number;
  invocationRetentionDays: number;
  adminMcpToken?: string;
  model: {
    provider: "deepseek" | "openai" | "stub";
    apiKey?: string;
    baseUrl?: string;
    name?: string;
    timeoutMs: number;
  };
  agentMaxSteps: number;
};

function loadDataKey(dataDir: string, explicit?: string): Buffer {
  if (explicit) return Buffer.from(explicit, "base64");
  const secretFile = resolve(dataDir, ".secret");
  if (existsSync(secretFile)) {
    const raw = readFileSync(secretFile, "utf8").trim();
    if (raw) return Buffer.from(raw, "base64");
  }
  const key = randomBytes(32);
  writeFileSync(secretFile, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(secretFile, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
  return key;
}

function build(): Config {
  loadDotEnv();

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    console.error(`Invalid configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }
  const env = parsed.data;

  const dataDir = isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(process.cwd(), env.DATA_DIR);
  mkdirSync(dataDir, { recursive: true });

  const databaseFile =
    env.DATABASE_FILE === ":memory:"
      ? ":memory:"
      : env.DATABASE_FILE
        ? isAbsolute(env.DATABASE_FILE)
          ? env.DATABASE_FILE
          : resolve(dataDir, env.DATABASE_FILE)
        : resolve(dataDir, "plexus.db");

  const webDistCandidate = resolve(packageRoot, "../web/dist");

  return {
    isProd: env.NODE_ENV === "production",
    host: env.HOST,
    port: env.PORT,
    dataDir,
    databaseFile,
    databaseUrl:
      databaseFile === ":memory:" ? ":memory:" : `file:${databaseFile.replace(/\\/g, "/")}`,
    logLevel: env.LOG_LEVEL,
    publicUrl: env.PUBLIC_URL ?? `http://${env.HOST}:${env.PORT}`,
    adminUsername: env.PLEXUS_ADMIN_USERNAME,
    adminPassword: env.PLEXUS_ADMIN_PASSWORD,
    sessionTtlMs: env.SESSION_TTL_HOURS * 3_600_000,
    cookieSecure: env.COOKIE_SECURE,
    trustProxy: env.TRUST_PROXY,
    dataKey: loadDataKey(dataDir, env.PLEXUS_DATA_KEY),
    version: env.PLEXUS_VERSION,
    webDist: existsSync(webDistCandidate) ? webDistCandidate : null,
    upstreamTimeoutMs: env.UPSTREAM_TIMEOUT_MS,
    egressAllowHosts: env.EGRESS_ALLOW_HOSTS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    rateLimitPerSec: env.RATE_LIMIT_PER_SEC,
    invocationRetentionDays: env.INVOCATION_RETENTION_DAYS,
    adminMcpToken: env.ADMIN_MCP_TOKEN,
    model: {
      provider: env.MODEL_PROVIDER,
      apiKey: env.MODEL_API_KEY,
      baseUrl: env.MODEL_BASE_URL,
      name: env.MODEL_NAME,
      timeoutMs: env.MODEL_TIMEOUT_MS,
    },
    agentMaxSteps: env.AGENT_MAX_STEPS,
  };
}

export const config = build();
