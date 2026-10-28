# Client setup

[English](CLIENTS.md) · [简体中文](../zh/CLIENTS.md)

Plexus speaks **MCP over Streamable HTTP** at `POST /mcp`. Every client needs two things:
the endpoint and a token.

```
URL:        http://127.0.0.1:3000/mcp      (or https://your-host/mcp)
Header:     Authorization: Bearer px_...
```

Create tokens in **Settings → Access tokens**. A `read` token only sees read-only tools.

## Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "plexus": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer px_your_token" }
    }
  }
}
```

Restart Claude Desktop; the tools appear under the tools icon.

## Claude Code (CLI)

```bash
claude mcp add --transport http plexus http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer px_your_token"
```

## Cursor

Create `.cursor/mcp.json` in your project (or the global equivalent):

```json
{
  "mcpServers": {
    "plexus": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer px_your_token" }
    }
  }
}
```

## VS Code

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "plexus": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer px_your_token" }
    }
  }
}
```

## curl

```bash
curl -sS http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer px_your_token' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A tool call:

```bash
curl -sS http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer px_your_token' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{"name":"todo__listTodos","arguments":{}}
  }'
```

## stdio-only clients

Some clients only speak stdio. Bridge them with any MCP proxy, for example
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "plexus": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://127.0.0.1:3000/mcp",
        "--header",
        "Authorization: Bearer px_your_token"
      ]
    }
  }
}
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401 Unauthorized` | Missing/revoked/expired token, or missing `Bearer ` prefix |
| Tools list is empty | No tool is **exposed**, or the token is `read` and every tool writes |
| `Unknown tool` | The tool was un-exposed or its app was disabled |
| `This token is read-only` | Call a read tool, or create a `write` token |
| Connection refused | `HOST=127.0.0.1` only listens locally; use a tunnel or reverse proxy |
