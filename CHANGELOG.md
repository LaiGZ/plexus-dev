# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-27

First public release: a single-binary personal MCP gateway.

### Added

- **Apps**: import OpenAPI 3.x / Swagger 2.x documents (URL or pasted) with internal
  `$ref` resolution, or define a single HTTP endpoint. Per-app auth (none, bearer, basic,
  custom header) encrypted at rest.
- **Tools**: stable MCP names (`source__tool`), per-tool exposure, enable/disable and
  side-effect control, editable JSON Schema, and a try-it panel.
- **Gateway**: scope checks, in-memory rate limiting, JSON Schema validation, idempotency
  ledger with lease takeover, invocation log with previews and request ids.
- **SSRF guard**: one DNS resolution, pinned socket, TLS SNI preserved, redirects refused,
  private/link-local ranges blocked unless allow-listed.
- **MCP**: Streamable HTTP endpoint using the official SDK, stateless per request, read/write
  bearer tokens with hashed storage and last-used tracking.
- **Assistant**: optional built-in agent over exposed tools, SSE streaming, and persisted
  write approvals. Works offline with a deterministic stub provider.
- **Assistant UI**: multiple conversations with a sidebar and derived titles, token-by-token
  streaming, Markdown rendering, and a restore-after-reload approval card. The system prompt
  has its own sub-page.
- **Model settings**: configure provider, base URL, model, key and timeout in Settings. The key
  is encrypted at rest, never echoed back, and can be verified with a test-connection action.
- **MCP hub**: remote MCP servers can be added as apps (discover tools, proxy calls), so one
  local `/mcp` endpoint aggregates several servers.
- **Scoped tokens**: MCP tokens can be limited to a subset of apps, and a searchable tool
  catalog shows everything currently exposed.
- **App-to-app calls**: issue an app secret, exchange it for a short-lived service token and
  call exposed methods via `POST /api/gateway/invoke`. Cross-app calls require an explicit
  per-app grant; the same app's own tools are always allowed.
- **Invocation log**: caller attribution (you / MCP / app / assistant), filters by app, caller
  and status, plus the existing request/result previews.
- **Config import/export**: export an app (no secrets) and import it back only into the same
  app id; the UI shows a diff (renamed, URL changed, methods added/updated/removed) before
  anything is written.
- **Method deletion**: deleting a method reports its grants, exposure and past call count, and
  requires acknowledgement when it is exposed or granted.
- **App templates**: download a commented YAML template and create an app from it; the platform
  generates the app id, and imported files are validated before the wizard prefills.
- **CLI**: zero-dependency `scripts/plexus.mjs` covering apps, methods, grants, tokens, calls and
  logs, with `--json` output and preview-first destructive commands (exit code 2).
- **Admin MCP**: `POST /admin/mcp` (enabled by `ADMIN_MCP_TOKEN`) exposes management tools —
  create/import/export apps, add/update/delete methods, grants, tokens, invoke and logs — with
  `confirm: true` required for destructive operations.
- **Bilingual UI**: English and Chinese, switchable from the header or the login screen and
  persisted per browser. Server errors are localized by their stable error code.
- **Operations**: single admin with a random password on first boot, automatic migrations,
  structured logs, `/healthz` with a database check, Docker image, compose file, CI and an
  end-to-end smoke script.

- **Terminology**: connected upstream APIs are called **apps** in the product (中文：应用);
  internal identifiers remain `source`, and the UI routes live under `/apps`.

### Security

- AES-256-GCM for upstream credentials; SHA-256 for tokens.
- Cookie sessions (`HttpOnly`, `SameSite=Lax`) plus a CSRF header requirement.
- Strict configuration validation with fail-fast startup.
