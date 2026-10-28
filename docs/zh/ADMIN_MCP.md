# 管理 MCP

第二个 MCP 端点，用来**管理实例本身**：创建应用、增删方法、管理授权、签发令牌、调用方法、
读取日志。它与 `/mcp` 分开，后者负责把应用暴露给客户端。

当 AI 助手应该通过 MCP 工具（而不是 shell）来操作 plexus 时使用它。如果 agent 能执行命令，
[CLI](CLI.md) 通常更简单。

[English](../en/ADMIN_MCP.md) · **简体中文**

## 启用

```bash
# 生成令牌
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

```bash
# apps/server/.env
ADMIN_MCP_TOKEN=刚生成的令牌
```

重启 API。不设置这个变量时端点**关闭**并返回 404。

```
POST http://127.0.0.1:3000/admin/mcp
Authorization: Bearer <ADMIN_MCP_TOKEN>
```

保持默认的回环绑定；如果要对外暴露，请在前面终止 TLS 并使用长令牌。

## 客户端配置

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

Cursor / VS Code 在各自的配置里使用同样的 URL 和 Header。

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_apps` | — | 应用及其工具/暴露数量 |
| `get_app` | `app` | 应用详情，含全部方法 |
| `create_app` | `template` | YAML/JSON `plexus.template.v1`；id 由平台生成 |
| `export_app` | `app` | `plexus.app.v1` JSON，不含凭据 |
| `import_app` | `app`, `config`, `removeMissing?`, `confirm?` | 返回 diff；**只有 `confirm=true` 才写入** |
| `list_tools` | `app?` | 方法列表 |
| `add_tool` | `app`, `name`, `method`, `path`, `sideEffect?`, `description?`, `inputSchema?`, `exposed?` | 仅 HTTP 应用 |
| `update_tool` | `tool` + 字段 | MCP 应用的方法不能重命名 |
| `delete_tool` | `tool`, `confirm?` | 返回授权/暴露/调用次数；**只有 `confirm=true` 才删除** |
| `list_grants` | `app` | 跨应用权限 |
| `set_grants` | `app`, `tools[]` | 整体替换 |
| `create_token` | `name`, `scope`, `apps?` | 原始令牌只返回一次 |
| `invoke_tool` | `tool`, `args`, `idempotencyKey?` | 走网关（审计/幂等） |
| `list_invocations` | `app?`, `status?`, `actor?`, `limit?` | 最新的在前 |

`app` 支持 id、名称或 slug。`tool` 支持 id、`finance.createBill`、`finance__createBill`，
或裸方法名。

## 确认流程

危险工具都是**预览优先**：

```
delete_tool { tool: "finance.createBill" }
  → { deleted: false, usage: { grantedApps: [...], exposed: true, invocationCount: 3 } }

delete_tool { tool: "finance.createBill", confirm: true }
  → { deleted: true, ... }
```

`import_app` 同理：不带 `confirm` 时返回 `{ applied: false, diff: {...} }`。agent 应该把结果
展示给用户，再加 `confirm: true` 重跑。

## curl 示例

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

## 安全模型

- 没设置 `ADMIN_MCP_TOKEN` 时管理端点**关闭**。
- 它与 `/mcp` 分离：拿着普通 `px_` 令牌的客户端不能管理任何东西。
- 危险操作需要 `confirm: true`；默认调用是只读的。
- `invoke_tool` 仍然走正常流水线：schema 校验、出网策略、幂等和调用日志（归属为
  `admin-mcp`）。
- 轮换令牌意味着改环境变量并重启；没有第二套令牌存储。

## CLI 与管理 MCP 的取舍

| | CLI（`scripts/plexus.mjs`） | 管理 MCP |
|---|---|---|
| 需要 shell | 是 | 否 |
| 输出 | `--json` | MCP JSON |
| 确认 | `--yes` | `confirm: true` |
| 适合 | 本地 agent、脚本、CI | 已经在用 MCP 的聊天助手 |

两者调用同一套 service，行为和校验完全一致。
