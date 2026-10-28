# Security

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) or email the maintainer listed in `package.json`.
Include a reproduction and the affected version; expect an acknowledgement within a few
days.

## Threat model

Plexus is a **single-owner** system. It assumes:

- One administrator, trusted with full control of the instance.
- The instance runs on a private network or behind an authenticating reverse proxy.
- MCP clients are configured by that same owner.

It does **not** defend against a compromised admin session, a malicious MCP client that
already holds a token, or a hostile operator of the upstream APIs you configure.

## Defaults that matter

| Control | Default | Notes |
|---|---|---|
| Bind address | `127.0.0.1` | Change only behind HTTPS |
| Cookie | `HttpOnly`, `SameSite=Lax` | `Secure` when `COOKIE_SECURE=true` |
| CSRF | `x-requested-with: plexus` required on mutations | On top of `SameSite` |
| Login attempts | 5 per 10 min per ip:user | In-memory (single process) |
| Token storage | SHA-256 hash, prefix shown in UI | Raw value shown once |
| Source credentials | AES-256-GCM under `DATA_DIR/.secret` | Rotate the file to invalidate |
| Egress | Private ranges blocked, redirects refused, DNS pinned | `EGRESS_ALLOW_HOSTS` for LAN |
| Tool exposure | Off | Writes additionally need a `write` token |
| Assistant writes | Require approval | Pending calls are persisted |

## Known limitations

- **Single process.** Rate limits, login throttling and the MCP transport are in memory;
  running multiple replicas against one SQLite file is unsupported.
- **No per-tool token scopes** yet: a token is `read` or `write` for everything exposed.
- **No OAuth for MCP.** Long-lived bearer tokens only; rotate by creating a new token and
  revoking the old one.
- **Model provider sees tool output.** If you enable the assistant, whatever a tool returns
  is sent to the configured model endpoint.

## Deployment checklist

1. `PLEXUS_ADMIN_PASSWORD` unset → capture the generated password, sign in, change it.
2. Terminate TLS in front of the process; set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
3. Keep `EGRESS_ALLOW_HOSTS` as small as possible.
4. Back up `DATA_DIR` (database + `.secret`); store it somewhere encrypted.
5. Restrict inbound access: VPN, IP allow-list, or Basic Auth at the proxy.
6. Watch `invocations` for unexpected write calls and revoke tokens you do not recognise.
