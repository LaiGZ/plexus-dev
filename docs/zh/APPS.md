# 应用与方法

**应用**是你接入的上游服务，**方法**是它上面的一个操作。导入本身不会暴露任何东西：方法
默认不开放给 MCP，且默认按只读处理。

[English](../en/APPS.md) · **简体中文**

## 从模板创建

在**应用 → 接入应用**里，你可以手填表单，也可以从模板开始：

- **下载模板**返回一个带注释的 YAML 文件（JSON 也可以）；
- 模板里**没有 `app_id`** —— 创建应用时由平台生成；
- **导入模板**会校验文件，预填应用名、Base URL、凭据和方法，然后直接进入方法步骤；
- 校验在服务端完成（`plexus.template.v1`）；非法文件会在创建任何东西之前被拒绝，并给出
  字段级错误。

## 导入 OpenAPI 文档

支持 OpenAPI 3.x 和常见的 Swagger 2.x 字段。可以填 URL，也可以粘贴 JSON/YAML 文本。

导入器做的事：

| 文档元素 | 变成什么 |
|---|---|
| `servers[0].url` | 应用 Base URL（相对地址需要手填 Base URL） |
| `operationId`（或方法 + 路径） | 方法名，前面拼上应用 slug |
| `summary` / `description` | 方法描述 |
| 路径参数 + 查询参数 + JSON 对象请求体 | 合并成一个 JSON Schema |
| `GET` / `HEAD` | `read` |
| `POST` / `PUT` / `PATCH` / `DELETE` | `write`（之后可以改） |

规则与限制：

- `$ref` 只解析**文档内部**的引用。外部引用会被拒绝，因为导入时网关不会去抓任意 URL。
- 循环引用会被截断并给出 warning。
- **非对象的请求体会被跳过**并提示，而不是生成一个会发出错误载荷的工具。
- 标记为 deprecated 的操作会跳过。
- 同一个应用里两个同名操作会被拒绝。

## 手动添加方法

不是每个服务都有 OpenAPI。在向导的**方法**步骤里可以加任意多个方法 —— 名称、HTTP 方法、
路径、副作用就够了。每个方法都会变成助手和 MCP 客户端可调用的工具。

- `name` 会参与生成 MCP 工具名（`应用slug__name`），尽量保持稳定。
- `path` 可以包含 `{param}` 占位符（`/todos/{id}`）。
- 会改数据的方法标记为 `write`；写操作需要 `write` 令牌，并在助手里点确认。
- OpenAPI 导入是可选的、增量的：导入的操作会追加进来，也可以像手写方法一样编辑或删除。

在确认步骤，**创建后开放给平台**会一次性开放所有方法。不勾选则先隐藏，之后在应用页逐个
打开。

## 聚合 MCP 服务器

如果上游本身就说 MCP，不需要 OpenAPI：填它的 `/mcp` 地址和鉴权，点**从 MCP 导入**。
平台会在远端调用 `tools/list` 并镜像这些工具。方法保留远端名称（不能重命名），调用会走
同一套校验、幂等和审计流水线。

远端工具如果没有声明 `readOnlyHint`，按写操作处理。

## 应用凭据（给后端调用）

在应用页点**生成密钥**，会返回一次 `pxa_…`。之后后端可以：

```bash
# 1. 换取 1 小时的服务令牌
curl -sS http://127.0.0.1:3000/api/gateway/token \
  -H 'content-type: application/json' \
  -d '{"appId":"<应用 id>","appSecret":"<密钥>"}'

# 2. 调用已暴露的方法
curl -sS http://127.0.0.1:3000/api/gateway/invoke \
  -H "authorization: Bearer <accessToken>" \
  -H 'content-type: application/json' \
  -d '{"tool":"<应用slug>__<方法>","args":{}}'
```

轮换密钥会让旧密钥签发的令牌立即失效。每次调用都会记为 `via=gateway-app`，发起应用作为
调用方。

应用永远可以调自己的工具，但**跨应用调用需要授权**：在调用方的应用页，勾选对方应用的工具
（**该应用可调用的工具**）。没有授权时网关返回 `403 no_grant`。

## 删除方法

删除前会先展示影响：哪些应用持有它的授权、它当前是否暴露给助手/MCP、历史调用多少次。
授权会随工具一起删除；调用历史保留。如果它已暴露或有授权，弹窗会要求显式勾选确认后才
能删除。导入预览在会删除方法时也会给出同样的授权提醒。

## 导入与导出应用

**导出配置**会下载 `<slug>.plexus.json`：

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

**凭据永远不会被导出。**

**导入配置**只接受从**同一个应用**导出的文件：`app.id` 必须与当前应用一致，否则以
`app_id_mismatch` 拒绝。解析完成后，界面会精确列出将要发生的变化 —— 应用名、Base URL、
新增方法、修改方法（含变化的字段）、删除方法 —— 在你确认之前不会写入任何东西。是否删除
「文件里没有的方法」是一个单独的勾选项。

## 接入 demo 应用

仓库自带 `scripts/connect-demo-apps.mjs`，会注册三个 demo 应用（`finance`、`project`、
`report`），开放它们的方法，配置跨应用授权，并把凭据写进每个 demo 的 `.env`：

```bash
BASE_URL=http://127.0.0.1:3000 PLEXUS_ADMIN_PASSWORD=... \
  node scripts/connect-demo-apps.mjs
```

然后在各自目录 `npm start` 启动 demo。可以试这条链路：

1. `POST :7002/api/createProject` → `P001`
2. `POST :7002/api/addExpense` `{ projectId: "P001", amount: 66 }`
   → 项目应用**经平台**调用 `finance__createBill`，返回 `billId`
3. `POST :7003/api/reportSummary`
   → 报表应用**经平台**读取财务和项目

调用日志里能看到这些调用，都是 `via=gateway-app`，调用方为对应应用。

## 路径、查询参数与请求体映射

以一个 `POST /todos/{id}`、参数为 `{ id, title }` 的工具为例：

- `id` 替换路径里的 `{id}`（URL 编码），并从请求体中移除。
- 其余参数在 `POST/PUT/PATCH` 里作为 JSON 请求体。
- 其余参数在 `GET/HEAD/DELETE` 里作为查询参数（数组会重复 key）。

## 鉴权

按应用配置：

| 类型 | 发送方式 |
|---|---|
| `none` | — |
| `bearer` | `Authorization: Bearer <token>` |
| `basic` | `Authorization: Basic base64(user:pass)` |
| `header` | `<name>: <value>` |

凭据使用 `DATA_DIR/.secret` 下的 AES-256-GCM 加密，API 永不返回。

## 出网与自托管上游

网关默认拒绝私网目标。要调用局域网或 localhost 的上游，把它的**主机名**加白：

```bash
EGRESS_ALLOW_HOSTS=127.0.0.1,localhost,api.internal
```

即便如此，网关也只会解析一次域名、把 socket 固定到该 IP、保持 TLS SNI/Host 为真实主机名，
并且绝不跟随重定向。

## 写入、幂等与确认

- 标记为 `write` 的工具需要 `write` scope 的令牌。
- 每次写调用都需要幂等键。MCP 客户端会根据令牌、工具和参数自动派生，所以重试会回放而不是
  重复执行。
- 内置助手遇到写工具一定会暂停，等你点同意/拒绝。

## 试调用

每个工具都有**试调用**：根据 schema 生成表单（也可以切原始 JSON），展示真实耗时和原始响应。
试调用与 MCP 调用走同一条流水线，也会出现在调用日志里。
