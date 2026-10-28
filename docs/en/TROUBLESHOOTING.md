# Troubleshooting

[English](TROUBLESHOOTING.md) · [简体中文](../zh/TROUBLESHOOTING.md)

Errors use one shape everywhere:

```json
{
  "error": {
    "code": "egress_blocked",
    "message": "api.internal resolves to a private address (10.0.0.4)",
    "hint": "Private destinations are blocked…",
    "requestId": "…"
  }
}
```

`requestId` also appears in the server log, and on MCP results as human-readable text.

## Login and access

| Code | Meaning | Fix |
|---|---|---|
| `unauthorized` | No session | Sign in again |
| `invalid_username_or_password` | Wrong credentials | — |
| `rate_limited` | 5 failed logins in 10 minutes | Wait, or restart the server |
| `forbidden` + CSRF hint | Mutating request without `x-requested-with: plexus` | The web UI sends it; custom scripts must too |

## Gateway

| Code | Meaning | Fix |
|---|---|---|
| `tool_not_exposed` | Tool exists but is not exposed | Flip **Exposed** on the app page |
| `source_disabled` | The whole app is disabled | Re-enable it |
| `read_only_token` | Token scope is `read`, tool writes | Create a `write` token |
| `invalid_args` | Arguments failed the tool schema | See `details[].path`; fix the call or the schema |
| `invalid_request` + idempotency hint | Write call without a key | Send `idempotencyKey` (≥ 8 chars) |
| `idempotency_mismatch` | Same key, different arguments | Use a new key for a new intent |
| `idempotency_in_progress` | Identical call is running | Wait and retry with the same key |
| `egress_blocked` | Destination resolves to a private IP | Allow-list the host in `EGRESS_ALLOW_HOSTS` |
| `upstream_redirect` | Upstream answered 3xx | Point the tool at the final URL |
| `upstream_timeout` | No response within `UPSTREAM_TIMEOUT_MS` | Raise the timeout or fix the upstream |
| `upstream_unreachable` | DNS/connect failure | Check the base URL and network |
| `upstream_error` | Upstream returned 4xx/5xx | Inspect the upstream; the gateway hides the body |

## MCP clients

| Symptom | Fix |
|---|---|
| `401` on every call | Token missing, revoked, expired, or no `Bearer ` prefix |
| Empty `tools/list` | Nothing exposed, app disabled, or token is `read` with only write tools |
| Client shows no server | Check JSON validity and that the client was restarted |
| Works locally, not remotely | `HOST=127.0.0.1` by default; see the deployment notes |

## Startup

| Symptom | Cause |
|---|---|
| `Invalid configuration:` + list | An env var failed validation; the message names the field |
| Permission denied on `DATA_DIR` | The container runs as `node` (uid 1000); `chown` the volume |
| `database is locked` | Two processes on one SQLite file; run exactly one |

## Logs

Logs are structured JSON. Useful filters:

```bash
journalctl -u plexus-api -f | jq 'select(.msg == "tool invocation failed")'
docker logs -f plexus | jq 'select(.level >= 40)'
```
