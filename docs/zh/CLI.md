# 命令行

零依赖的命令行，用来管理运行中的 plexus。它面向**人和 AI agent** 设计：稳定的退出码、
危险操作预览优先、`--json` 输出机器可读结果。

[English](../en/CLI.md) · **简体中文**

```bash
export PLEXUS_URL=http://127.0.0.1:3000
export PLEXUS_ADMIN_PASSWORD=...

node scripts/plexus.mjs apps list
```

不需要 npm install，没有额外依赖 —— 它用 `fetch`，每次调用现登录（不往磁盘写任何东西）。

## 命令

| 命令 | 作用 |
|---|---|
| `apps list` | 应用列表，含工具/暴露数量 |
| `apps get <app>` | 应用详情与方法 |
| `apps create --file <template>` | 从 YAML/JSON 模板创建应用（id 由平台生成） |
| `apps import <app> --file <export>` | 预览配置 diff；`--yes` 才应用 |
| `apps export <app> [--out file]` | 导出 `plexus.app.v1` |
| `apps secret <app>` | 生成/轮换应用密钥（只显示一次） |
| `tools list [--app <app>]` | 跨应用查看方法 |
| `tools add <app> --name n --method POST --path /x [--write] [--expose]` | 添加方法 |
| `tools expose <tool> [--off]` | 切换是否暴露给助手/MCP |
| `tools enable <tool> [--off]` | 切换方法启用状态 |
| `tools delete <tool> --yes` | 打印授权/暴露/调用次数后删除 |
| `grants list <app>` / `grants set <app> --tools a,b` | 应用间授权 |
| `tokens list` / `tokens create --name n --scope write [--apps a,b]` | MCP 令牌 |
| `invoke <tool> --args '{"k":"v"}'` | 经网关试调用方法 |
| `logs [--app a] [--status s] [--actor a] [--limit n]` | 调用日志 |

`<app>` 支持应用 id、名称或 slug。`<tool>` 支持工具 id、`finance.createBill`、
`finance__createBill`，或裸方法名。

## 退出码

| 码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 出错（消息输出到 stderr） |
| `2` | 仅预览 —— 危险操作因为没带 `--yes` 而没有执行 |

agent 应该把 `2` 理解为「先把影响展示给用户，确认后再加 `--yes` 重跑」。

## 示例

```bash
# 从模板创建
node scripts/plexus.mjs apps create --file my-app.yaml --json

# 加一个写方法并开放
node scripts/plexus.mjs tools add finance \
  --name createBill --method POST --path /api/createBill --write --expose \
  --schema '{"type":"object","properties":{"amount":{"type":"number"}},"required":["amount"]}'

# 让 Project 应用可以调用它
node scripts/plexus.mjs grants set Project --tools finance.createBill

# 试调用
node scripts/plexus.mjs invoke finance.createBill --args '{"amount":42}'

# 导出、编辑、预览 diff、应用
node scripts/plexus.mjs apps export Finance --out finance.json
node scripts/plexus.mjs apps import Finance --file finance.json        # 打印 diff，退出码 2
node scripts/plexus.mjs apps import Finance --file finance.json --yes  # 真正应用

# 最近的应用间调用
node scripts/plexus.mjs logs --actor app --limit 20 --json
```

## 给 AI agent 的建议

- 优先用 `--json`；每条命令在 stdout 输出一个 JSON 文档。
- 危险命令**先不带** `--yes` 跑一次：它会打印影响（授权、暴露、调用次数、配置 diff）并以
  退出码 `2` 结束。
- `apps create` 和 `apps import` 都在服务端校验；非零退出会带上 API 错误。
- 模板（`plexus.template.v1`）永远不含 `app_id`，由平台生成。导出文件
  （`plexus.app.v1`）含 `app_id`，只能导回同一个应用。
- 凭据从 `PLEXUS_ADMIN_PASSWORD`（或 `--password`）读取；进程列表可能被其他人看到时，
  不要把密码放进 argv。
