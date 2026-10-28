# Architecture

[English](ARCHITECTURE.md) · [简体中文](../zh/ARCHITECTURE.md)

Short, opinionated and current. If a rule is not here, it is not a rule.

> **Terminology.** In the product an upstream API is an **app** (中文：应用). Internally the entity
> is still `source` (table name, API path, error codes); renaming it would need a destructive
> migration with no user benefit.

## Principles

1. **One process, one owner, one file.** A personal gateway should run from a container with
   a volume — not a compose stack with Redis and Postgres.
2. **The contract is enforced, not documented.** Any JSON Schema shown to an LLM or an MCP
   client is validated at the gateway boundary.
3. **Safe by default.** Read-only until marked otherwise, loopback until configured, nothing
   exposed until switched on, no telemetry.
4. **One way to do a thing.** One error envelope, one config module, one validation path, one
   invocation path.

## Layout

```
packages/contracts        zod schemas + inferred types shared by server and web
apps/server/src
  config.ts               zod-validated env; the only place that reads process.env
  app.ts                  Hono app, error boundary, SPA/static serving
  index.ts                boot: pragmas → migrations → seed → listen → shutdown
  http/                   request id + access log, CSRF, auth, body validation
  routes/                 auth, sources, tools, tokens, invocations, stats, agent, mcp
  domain/
    source/               OpenAPI / HTTP / MCP import, preview, source/tool lifecycle
    invoke/               pipeline, request building, schema validation, idempotency
    gateway/              app credentials: secret -> service token -> invoke
    tokens/               bearer tokens for /mcp (optionally scoped to apps)
    invocations/          invocation log + retention
    agent/                model gateway + the built-in assistant
    stats/                dashboard counters
  mcp/server.ts           official SDK server, one instance per request
  mcp client              domain/source/mcp.ts proxies remote MCP servers
  infra/                  crypto, errors, egress, upstream client, logs, db
apps/web/src
  router.tsx              TanStack Router; auth guard on the layout route
  lib/                    fetch wrapper + react-query hooks typed by contracts
  components/             shell, UI primitives, client config, try-it, logs
  pages/                  Overview, Sources, SourceNew, SourceDetail, Chat, Settings
```

## Runtime decisions

### HTTP: Hono

Small, typed, and its Web-standard `Request`/`Response` shape is exactly what the MCP SDK's
`WebStandardStreamableHTTPServerTransport` consumes. No adapter glue.

### Database: SQLite via libsql + Drizzle

- SQLite is the right answer for one user and one process, not a compromise.
- `@libsql/client` ships prebuilt binaries as normal npm packages, so `pnpm install` works on
  any Node version without a C++ toolchain.
- `WAL`, `busy_timeout=5000`, `foreign_keys=ON` are set on boot.
- Migrations run automatically; the operator never runs a migration command.

### Auth: opaque sessions

- Password → `scrypt` hash (Node core, no native dependency).
- Session: random token, `sha256` stored, `HttpOnly` + `SameSite=Lax` cookie.
- Mutations with a session require `x-requested-with: plexus` (defense in depth).
- Roles exist (`roles` table) with a single seeded `super_admin` row; permissions are explicit
  without inventing a multi-tenant model.

### Configuration

`config.ts` validates everything with zod, resolves paths, creates `DATA_DIR`, and generates a
32-byte data key at `DATA_DIR/.secret`. Invalid values abort startup with a field list.
Business code imports `config`; ESLint forbids `process.env` elsewhere. This also fixes a
class of bug where module-level constants read env before `.env` is loaded.

## The invocation pipeline

Every call — MCP, try-it, assistant — goes through `domain/invoke/pipeline.ts`:

```
load tool + source
  → source/tool enabled and exposed
  → scope covers side effect          (read token cannot write)
  → rate limit                        (token bucket, per token × tool)
  → validate args against JSON Schema (Ajv, compiled once per schema)
  → idempotency begin                 (writes only; three-state ledger)
  → build request                     (path params, query, JSON body, auth)
  → egress check + forward            (pinned IP, no redirects, 15s default)
  → idempotency settle
  → record invocation                 (never fails the call)
```

Details that matter:

- **SSRF**: DNS is resolved once and the socket is pinned to that IP; `lookup` is overridden in
  the HTTP client, TLS `servername` stays on the real hostname, redirects are refused. Private
  ranges are rejected unless the host is in `EGRESS_ALLOW_HOSTS`.
- **Idempotency**: unique `(scope, key)` with `done / in_progress / digest mismatch` states and
  a 30s lease that a crashed caller can take over.
- **Previews** are truncated at 2 000 characters; upstream bodies are capped at 2 MiB.

## MCP

- **Northbound**: the official `@modelcontextprotocol/sdk`, Streamable HTTP, **stateless**: a
  server and transport per request, closed afterwards. No session table, no leaked state.
- **Southbound**: an app can itself be an MCP server (`kind = mcp`). The platform connects with
  the SDK client, imports the remote `tools/list`, and proxies `tools/call` through the same
  pipeline — so one local endpoint can aggregate several remote MCP servers.
- Tools = exposed ∩ tool enabled ∩ source enabled; a `read` token only sees read tools.
- Tokens can be scoped to a subset of apps (`token_apps`); no rows means every app.
- Tool names are stable: `{app_slug}__{tool}`, `[A-Za-z0-9_-]{1,64}`, collisions get a numeric suffix.
- Write results are idempotent by derivation: `sha256(token | tool | args)` when the client does
  not supply a key.

## App-to-app calls

Backends that are not MCP clients can use the REST gateway:

```
POST /api/gateway/apps/:id/secret     (owner)  -> app_secret, shown once
POST /api/gateway/token               {appId, appSecret} -> short-lived access token (1h)
POST /api/gateway/invoke              Bearer token + {tool, args} -> same pipeline
```

Only exposed tools of enabled apps are callable, and every call is attributed to the calling
app in the invocation log (`via=gateway-app`, `actorType=app`). Rotating the secret invalidates
previously issued tokens. Cross-app calls additionally require a **grant** (`app_grants`):
an app may always call its own tools, but calling another app's tool returns `403 no_grant`
until the owner selects it on the caller's app page.

## Assistant

- Multiple conversations, each stored in SQLite; the sidebar lists them with a derived title
  from the first message.
- OpenAI-compatible chat with **streaming text** and native tool calling. Provider defaults to
  DeepSeek; `stub` gives deterministic offline behaviour for tests and demos.
- Model configuration lives in **Settings → Model** (provider, base URL, model, key, timeout).
  The key is encrypted with the instance data key and never returned by the API; a
  test-connection action verifies it. Environment variables remain the fallback.
- The system prompt has its own sub-page (`/chat/prompt`) and is stored in `settings`.
- The loop stops on the first **write** call and persists a `pending_tool_call`. The pending
  call is returned with the conversation history, so a page reload restores the approval card.
  Approval resumes the loop; rejection feeds the refusal back to the model.
- If a model returns several tool calls and one of them writes, the ones after it are answered
  with an explicit "skipped" result so every `tool_call` keeps a matching tool message.
- Without an API key the assistant reports `enabled: false` and links to Settings — it never
  fails at runtime.

## Error envelope

```json
{ "error": { "code": "invalid_args", "message": "…", "hint": "…", "details": [], "requestId": "…" } }
```

`code` is stable and machine readable; `message` is human readable; `requestId` matches the
`x-request-id` header and the log line. MCP translates codes into guidance text because models
read those strings.

## Frontend

Four destinations:

| Route | Job |
|---|---|
| `/` | Endpoint, token state, today's calls, copy-paste client configs, recent activity |
| `/apps` | Import (3 steps), tool list, per-tool exposure, try-it, per-app logs |
| `/chat` | Built-in assistant with write approval |
| `/settings` | Account, tokens, data |

Rules: every list has an empty state with one primary action; destructive actions require
typing the resource name; errors show `message` + `hint`; write tools are visually marked.

## Testing

| Layer | What |
|---|---|
| Unit | password/crypto, request building, SSRF ranges, OpenAPI mapping, naming |
| Integration | the pipeline against a real local upstream; idempotent replay; upstream failures |
| Contract | a real MCP SDK client against the running app (list + call) |
| Agent | stub provider: read loop, approval, rejection, double-resolve, history |
| E2E | `scripts/smoke.mjs`: import → expose → try → token → MCP call → logs → stats |

## What we deliberately do not do

- Multi-tenancy, orgs, RBAC screens, DLP.
- A `Grant` entity: with one subject it degenerates to `tool.exposed` + `token.scope`.
- An outbox worker for audit: a single insert is enough at this scale.
- RS256/JWKS context signing: upstreams get a bearer/header credential instead.
- Background job queues. If a feature needs one, it needs a product decision first.
