# 客户端配置

plexus 在 `POST /mcp` 上提供 **MCP over Streamable HTTP**。每个客户端只需要两样东西：
端点地址和令牌。

```
URL:        http://127.0.0.1:3000/mcp      （或 https://your-host/mcp）
Header:     Authorization: Bearer px_...
```

在**设置 → 访问令牌**里创建令牌。`read` 令牌只能看到只读工具。

[English](../en/CLIENTS.md) · **简体中文**

## Claude Desktop

编辑 `claude_desktop_config.json`（macOS：`~/Library/Application Support/Claude/`，
Windows：`%APPDATA%\Claude\`）：

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

重启 Claude Desktop，工具会出现在工具图标下面。

## Claude Code（CLI）

```bash
claude mcp add --transport http plexus http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer px_your_token"
```

## Cursor

在项目里创建 `.cursor/mcp.json`（或全局配置）：

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

创建 `.vscode/mcp.json`：

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

调用一个工具：

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

## 只支持 stdio 的客户端

有些客户端只会说 stdio。用任意 MCP 代理桥接即可，例如
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote)：

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

## 故障排查

| 现象 | 原因 |
|---|---|
| `401 Unauthorized` | 令牌缺失/已吊销/已过期，或少了 `Bearer ` 前缀 |
| 工具列表为空 | 没有方法**已暴露**，或令牌是 `read` 而所有工具都是写操作 |
| `Unknown tool` | 工具被取消暴露，或所属应用被禁用 |
| `This token is read-only` | 调只读工具，或创建一个 `write` 令牌 |
| 连接被拒绝 | `HOST=127.0.0.1` 只监听本机；用隧道或反向代理 |
