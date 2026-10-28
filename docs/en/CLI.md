# CLI

[English](CLI.md) · [简体中文](../zh/CLI.md)

A zero-dependency command line for managing a running Plexus instance. It is designed to be
used by **people and AI agents**: stable exit codes, preview-first destructive actions, and
machine-readable output with `--json`.

```bash
export PLEXUS_URL=http://127.0.0.1:3000
export PLEXUS_ADMIN_PASSWORD=...

node scripts/plexus.mjs apps list
```

No npm install, no extra packages — it uses `fetch` and logs in per invocation (nothing is
written to disk).

## Commands

| Command | What it does |
|---|---|
| `apps list` | Apps with tool/exposed counts |
| `apps get <app>` | App details and methods |
| `apps create --file <template>` | Create an app from a YAML/JSON template (id generated) |
| `apps import <app> --file <export>` | Preview a config diff; `--yes` applies it |
| `apps export <app> [--out file]` | Write a `plexus.app.v1` export |
| `apps secret <app>` | Issue/rotate the app secret (shown once) |
| `tools list [--app <app>]` | Methods across apps |
| `tools add <app> --name n --method POST --path /x [--write] [--expose]` | Add a method |
| `tools expose <tool> [--off]` | Toggle exposure to the assistant/MCP |
| `tools enable <tool> [--off]` | Toggle the method |
| `tools delete <tool> --yes` | Delete after printing grants/exposure/call count |
| `grants list <app>` / `grants set <app> --tools a,b` | App-to-app permissions |
| `tokens list` / `tokens create --name n --scope write [--apps a,b]` | MCP tokens |
| `invoke <tool> --args '{"k":"v"}'` | Try a method through the gateway |
| `logs [--app a] [--status s] [--actor a] [--limit n]` | Invocation log |

`<app>` accepts the app id, name, or slug. `<tool>` accepts the tool id, `finance.createBill`,
`finance__createBill`, or the bare method name.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (message on stderr) |
| `2` | Preview only — a destructive action was not applied because `--yes` was missing |

Agents should treat `2` as "show this to the user and ask before re-running with `--yes`".

## Examples

```bash
# Create from a template
node scripts/plexus.mjs apps create --file my-app.yaml --json

# Add a write method and expose it
node scripts/plexus.mjs tools add finance \
  --name createBill --method POST --path /api/createBill --write --expose \
  --schema '{"type":"object","properties":{"amount":{"type":"number"}},"required":["amount"]}'

# Let the Project app call it
node scripts/plexus.mjs grants set Project --tools finance.createBill

# Try it
node scripts/plexus.mjs invoke finance.createBill --args '{"amount":42}'

# Export, edit, preview the diff, apply
node scripts/plexus.mjs apps export Finance --out finance.json
node scripts/plexus.mjs apps import Finance --file finance.json        # prints the diff, exit 2
node scripts/plexus.mjs apps import Finance --file finance.json --yes  # applies

# Recent app-to-app calls
node scripts/plexus.mjs logs --actor app --limit 20 --json
```

## For AI agents

- Prefer `--json`; every command prints one JSON document on stdout.
- Run destructive commands **without** `--yes` first: they print the impact (grants, exposure,
  call counts, config diff) and exit `2`.
- `apps create` and `apps import` validate server-side; a non-zero exit includes the API error.
- Templates (`plexus.template.v1`) never contain an `app_id`; the platform generates it.
  Exports (`plexus.app.v1`) do, and can only be imported back into the same app.
- Credentials come from `PLEXUS_ADMIN_PASSWORD` (or `--password`); do not put them in argv when
  the process list is shared.
