# Admin MCP

[English](ADMIN_MCP.md) · [简体中文](../zh/ADMIN_MCP.md)

A second MCP endpoint for **managing the instance itself**: create apps, add or delete methods,
manage grants, issue tokens, call methods and read the log. It is separate from `/mcp`, which
exposes your apps to clients.

Use it when an AI assistant should operate Plexus through MCP tools instead of a shell. If the
agent can run commands, the [CLI](CLI.md) is usually simpler.

## Enable it

```bash
# generate a token
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

```bash
# apps/server/.env
ADMIN_MCP_TOKEN=the-generated-token
```

Restart the API. Without the variable the endpoint is **disabled** and returns 404.

```
POST http://127.0.0.1:3000/admin/mcp
Authorization: Bearer <ADMIN_MCP_TOKEN>
```

Keep the default loopback bind; if you expose it, terminate TLS in front and use a long token.

## Client configuration

```json
{
  "mcpServers": {
    "plexus-admin": {
      "type": "http",
      "url": "http://127.0.0.1:3000/admin/mcp",
      "headers": { "Authorization": "Bearer <ADMIN_MCP_TOKEN>" }
    }
  }
}
```

Cursor / VS Code use the same URL and header in their respective config files.

## Tools

| Tool | Arguments | Notes |
|---|---|---|
| `list_apps` | — | Apps with tool/exposure counts |
| `get_app` | `app` | Full detail incl. methods |
| `create_app` | `template` | YAML/JSON `plexus.template.v1`; id generated |
| `export_app` | `app` | `plexus.app.v1` JSON, no credentials |
| `import_app` | `app`, `config`, `removeMissing?`, `confirm?` | Returns the diff; **writes only with `confirm=true`** |
| `list_tools` | `app?` | Methods |
| `add_tool` | `app`, `name`, `method`, `path`, `sideEffect?`, `description?`, `inputSchema?`, `exposed?` | HTTP apps only |
| `update_tool` | `tool`, fields | MCP apps cannot be renamed |
| `delete_tool` | `tool`, `confirm?` | Returns grants/exposure/call count; **deletes only with `confirm=true`** |
| `list_grants` | `app` | Cross-app permissions |
| `set_grants` | `app`, `tools[]` | Replaces the set |
| `create_token` | `name`, `scope`, `apps?` | Raw token returned once |
| `invoke_tool` | `tool`, `args`, `idempotencyKey?` | Goes through the gateway (audit/idempotency) |
| `list_invocations` | `app?`, `status?`, `actor?`, `limit?` | Newest first |

`app` accepts the id, name or slug. `tool` accepts the id, `finance.createBill`,
`finance__createBill`, or the bare method name.

## Confirmation pattern

Destructive tools are **preview-first**:

```
delete_tool { tool: "finance.createBill" }
  → { deleted: false, usage: { grantedApps: [...], exposed: true, invocationCount: 3 } }

delete_tool { tool: "finance.createBill", confirm: true }
  → { deleted: true, ... }
```

`import_app` behaves the same: without `confirm` it returns `{ applied: false, diff: {...} }`.
Agents should show that result to the user before re-running with `confirm: true`.

## Example with curl

```bash
curl -sS http://127.0.0.1:3000/admin/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer <ADMIN_MCP_TOKEN>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```bash
curl -sS http://127.0.0.1:3000/admin/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer <ADMIN_MCP_TOKEN>' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{
      "name":"create_app",
      "arguments":{
        "template":"format: plexus.template.v1\napp:\n  name: Demo\n  baseUrl: http://127.0.0.1:7100\ntools:\n  - name: ping\n    method: GET\n    path: /health\n    sideEffect: read\n"
      }
    }
  }'
```

## Safety model

- The admin endpoint is **off** unless `ADMIN_MCP_TOKEN` is set.
- It is separate from `/mcp`: clients with a normal `px_` token cannot manage anything.
- Destructive operations require `confirm: true`; the default call is read-only.
- `invoke_tool` still goes through the normal pipeline: schema validation, egress policy,
  idempotency and the invocation log (attributed to `admin-mcp`).
- Rotating the token means editing the env and restarting; there is no second token store.

## CLI vs admin MCP

| | CLI (`scripts/plexus.mjs`) | Admin MCP |
|---|---|---|
| Needs a shell | yes | no |
| Output | `--json` | MCP JSON |
| Confirmation | `--yes` | `confirm: true` |
| Best for | local agents, scripts, CI | chat assistants already using MCP |

Both call the same services, so behaviour and validation are identical.
