# 故障排查

所有错误都是同一种形状：

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

`requestId` 也会出现在服务端日志里；MCP 结果里会以可读文本呈现。

[English](../en/TROUBLESHOOTING.md) · **简体中文**

## 登录与访问

| Code | 含义 | 处理 |
|---|---|---|
| `unauthorized` | 没有会话 | 重新登录 |
| `invalid_username_or_password` | 账号或密码错误 | — |
| `rate_limited` | 10 分钟内失败 5 次 | 等待，或重启服务 |
| `forbidden` + CSRF 提示 | 写请求缺少 `x-requested-with: plexus` | 前端会自动带；自写脚本也要带 |

## 网关

| Code | 含义 | 处理 |
|---|---|---|
| `tool_not_exposed` | 工具存在但未暴露 | 在应用页打开**已暴露** |
| `source_disabled` | 整个应用被禁用 | 重新启用 |
| `read_only_token` | 令牌是 `read`，工具是写操作 | 创建 `write` 令牌 |
| `invalid_args` | 参数不符合工具 schema | 看 `details[].path`，修调用或 schema |
| `invalid_request` + 幂等提示 | 写调用没带幂等键 | 传 `idempotencyKey`（≥ 8 字符） |
| `idempotency_mismatch` | 同一个键配了不同参数 | 新意图用新键 |
| `idempotency_in_progress` | 相同调用正在执行 | 等待后用同一个键重试 |
| `egress_blocked` | 目标解析到私网 IP | 把主机加入 `EGRESS_ALLOW_HOSTS` |
| `upstream_redirect` | 上游返回 3xx | 把工具指向最终地址 |
| `upstream_timeout` | `UPSTREAM_TIMEOUT_MS` 内没有响应 | 调大超时或修上游 |
| `upstream_unreachable` | DNS/连接失败 | 检查 Base URL 与网络 |
| `upstream_error` | 上游返回 4xx/5xx | 去查上游；网关不会透出响应体 |

## MCP 客户端

| 现象 | 处理 |
|---|---|
| 每次调用都 `401` | 令牌缺失、已吊销、已过期，或没带 `Bearer ` |
| `tools/list` 为空 | 没有暴露任何方法、应用被禁用，或令牌是 `read` 而工具都是写操作 |
| 客户端看不到服务 | 检查 JSON 是否合法，以及客户端是否重启过 |
| 本地能用、远程不能用 | 默认 `HOST=127.0.0.1`；参考部署说明 |

## 启动

| 现象 | 原因 |
|---|---|
| `Invalid configuration:` + 列表 | 某个环境变量校验失败；消息里会指出字段 |
| `DATA_DIR` 权限不足 | 容器以 `node`（uid 1000）运行；`chown` 数据卷 |
| `database is locked` | 同一个 SQLite 文件被两个进程打开；只跑一个 |

## 日志

日志是结构化 JSON。常用过滤：

```bash
journalctl -u plexus-api -f | jq 'select(.msg == "tool invocation failed")'
docker logs -f plexus | jq 'select(.level >= 40)'
```
