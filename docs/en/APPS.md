# Apps and tools

[English](APPS.md) · [简体中文](../zh/APPS.md)

An **app** is an upstream service you connect. A **tool** is one operation on it. Importing never
exposes anything: tools start disabled for MCP and read-only.

## Create from a template

On **Apps → Connect app** you can fill the form by hand or start from a template:

- **Download template** returns a commented YAML file (JSON works too);
- the template has **no `app_id`** — the platform generates it when the app is created;
- **Import template** validates the file, prefills the app name, base URL, credentials and
  methods, and jumps to the methods step;
- validation is server-side (`plexus.template.v1`); invalid files are rejected with
  field-level issues before anything is created.

## Import an OpenAPI document

Supported: OpenAPI 3.x and the common Swagger 2.x fields. Provide a URL or paste the
document (JSON or YAML).

What the importer does:

| Spec element | Becomes |
|---|---|
| `servers[0].url` | App base URL (relative servers need a base URL override) |
| `operationId` (or method + path) | Tool name, prefixed with the app slug |
| `summary` / `description` | Tool description |
| Path + query parameters + JSON object body | Merged into one JSON Schema |
| `GET` / `HEAD` | `read` |
| `POST` / `PUT` / `PATCH` / `DELETE` | `write` (you can change this later) |

Rules and limits:

- `$ref` is resolved **inside** the document only. External references are refused, because
  the gateway will not fetch arbitrary URLs while importing.
- Circular references are cut and reported as a warning.
- **Non-object request bodies are skipped** with a warning rather than producing a tool that
  would silently send the wrong payload.
- Deprecated operations are skipped.
- Two operations with the same name inside one app are rejected.

## Add methods by hand

Not every service has an OpenAPI document. On the wizard's **Methods** step you can add as
many methods as you need — name, HTTP method, path and side effect are enough. Each method
becomes a tool the assistant and MCP clients can call.

- `name` is used to build the MCP tool name (`app-slug__name`), so keep it stable.
- `path` may contain `{param}` placeholders (`/todos/{id}`).
- Mark a method as `write` if it changes data; writes require a `write` token and an approval
  click in the assistant.
- OpenAPI import is optional and additive: imported operations are appended and can be edited
  or removed like hand-written ones.

At the review step, **Expose to the platform after creating** publishes every method at once.
Leave it off to create them hidden and enable them one by one on the app page.

## Aggregate an MCP server

If the upstream already speaks MCP, you do not need OpenAPI: give the app the server's
`/mcp` URL and its auth, then **Import from MCP**. The platform calls `tools/list` on the
remote server and mirrors those tools. Methods keep the remote names (they cannot be
renamed) and calls are proxied through the same validation, idempotency and audit pipeline.

Remote tools without a `readOnlyHint` are treated as writes.

## App credentials (backend callers)

On the app page, **Issue secret** returns `pxa_…` exactly once. A backend can then:

```bash
# 1. exchange for a 1h service token
curl -sS http://127.0.0.1:3000/api/gateway/token \
  -H 'content-type: application/json' \
  -d '{"appId":"<app id>","appSecret":"<secret>"}'

# 2. call an exposed method
curl -sS http://127.0.0.1:3000/api/gateway/invoke \
  -H "authorization: Bearer <accessToken>" \
  -H 'content-type: application/json' \
  -d '{"tool":"<app_slug>__<method>","args":{}}'
```

Rotating the secret invalidates tokens issued with the old one. Every call is logged with
`via=gateway-app` and the calling app as the actor.

An app can always call its own tools, but **cross-app calls need a grant**: on the caller's app
page, tick the other apps' tools under **Tools this app may call**. Without a grant the gateway
returns `403 no_grant`.

## Deleting a method

Deleting a method first reports what it affects: which apps hold a grant for it, whether it is
currently exposed to the assistant/MCP, and how many past invocations it has. Grants are removed
with the tool; invocation history is kept. If it is exposed or granted, the dialog requires an
explicit acknowledgement before the delete button enables. Import previews show the same
grant warning for methods that would be removed.

## Import and export an app

**Export config** downloads `<slug>.plexus.json`:

```json
{
  "format": "plexus.app.v1",
  "app": { "id": "...", "name": "Finance", "kind": "http", "baseUrl": "http://127.0.0.1:7001" },
  "tools": [
    { "name": "createBill", "method": "POST", "path": "/api/createBill",
      "sideEffect": "write", "inputSchema": { }, "exposed": true, "enabled": true }
  ]
}
```

Credentials are never exported.

**Import config** only accepts a file exported from the **same app**: the `app.id`
must match the current app, otherwise the import is rejected with `app_id_mismatch`.
After parsing, the UI shows exactly what will change — app name, base URL, added
methods, updated methods (with the changed fields) and removed methods — and nothing
is written until you confirm. Removing methods that are missing from the file is a
separate opt-in checkbox.

## Wiring the demo apps

The repository ships `scripts/connect-demo-apps.mjs`, which registers the three demo apps
(`finance`, `project`, `report`), exposes their methods, grants the cross-app calls and writes
each demo's `.env`:

```bash
BASE_URL=http://127.0.0.1:3000 PLEXUS_ADMIN_PASSWORD=... \
  node scripts/connect-demo-apps.mjs
```

Then start each demo (`npm start` in its directory). Flow to try:

1. `POST :7002/api/createProject` → `P001`
2. `POST :7002/api/addExpense` `{ projectId: "P001", amount: 66 }`
   → project calls `finance__createBill` **through the platform** and returns `billId`
3. `POST :7003/api/reportSummary`
   → report reads finance + project **through the platform**

The invocation log shows all of these with `via=gateway-app` and the calling app as actor.

## Path, query and body mapping

Given a tool with `POST /todos/{id}` and arguments `{ id, title }`:

- `id` replaces `{id}` in the path (URL-encoded) and is removed from the body.
- Remaining arguments become the JSON body for `POST/PUT/PATCH`.
- Remaining arguments become query parameters for `GET/HEAD/DELETE` (arrays repeat the key).

## Authentication

Per app:

| Type | Sent as |
|---|---|
| `none` | — |
| `bearer` | `Authorization: Bearer <token>` |
| `basic` | `Authorization: Basic base64(user:pass)` |
| `header` | `<name>: <value>` |

Credentials are encrypted with AES-256-GCM using `DATA_DIR/.secret` and are never returned
by the API.

## Egress and self-hosted upstreams

The gateway refuses private destinations by default. To call an upstream on your LAN or
localhost, allow-list its **hostname**:

```bash
EGRESS_ALLOW_HOSTS=127.0.0.1,localhost,api.internal
```

Even then, the gateway resolves the hostname once, pins the socket to that IP, keeps TLS
SNI/Host on the real hostname, and never follows redirects.

## Writes, idempotency and approvals

- A tool marked `write` requires a token with `write` scope.
- Every write call needs an idempotency key. MCP clients get one derived automatically from
  the token, tool and arguments, so a retried request is replayed instead of executed twice.
- The built-in assistant always pauses write tools for an explicit approve/reject click.

## Try it

Every tool has a **Try** action: a form generated from the schema (or raw JSON), the real
latency, and the raw response. Try-it calls go through the same pipeline as MCP calls and
appear in the invocation log.
