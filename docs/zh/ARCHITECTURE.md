# 架构

简短、有观点、与代码同步。这里没写的，就不算规则。

[English](../en/ARCHITECTURE.md) · **简体中文**

> **术语。** 产品里把上游 API 叫作**应用**（app）。内部实体仍叫 `source`（表名、API 路径、
> 错误码）；改名需要破坏性迁移，对用户没有收益。

## 原则

1. **一个进程、一个所有者、一个文件。** 个人网关应该用「容器 + 数据卷」跑起来，而不是一套
   Redis + Postgres 的 compose 栈。
2. **契约是执行的，不是写文档的。** 任何展示给 LLM 或 MCP 客户端的 JSON Schema，都会在网关
   边界被真正校验。
3. **默认安全。** 没标记就是只读，没配置就只监听回环，不打开就不暴露，没有遥测。
4. **一件事只有一种做法。** 一套错误信封、一个配置模块、一条校验路径、一条调用路径。

## 目录结构

```
packages/contracts        zod schema 与推导类型，server 和 web 共用
apps/server/src
  config.ts               zod 校验的环境变量；唯一读取 process.env 的地方
  app.ts                  Hono 应用、错误边界、SPA/静态资源
  index.ts                启动：pragma → 迁移 → seed → 监听 → 优雅退出
  http/                   请求 ID + 访问日志、CSRF、鉴权、请求体校验
  routes/                 auth、sources、tools、tokens、invocations、stats、agent、mcp
  domain/
    source/               OpenAPI / HTTP / MCP 导入、预览、应用与方法的生命周期
    invoke/               流水线、请求构造、schema 校验、幂等
    gateway/              应用凭据：secret → 服务令牌 → 调用
    tokens/               给 /mcp 的 Bearer 令牌（可按应用限制）
    invocations/          调用日志与保留策略
    agent/                模型网关与内置助手
    stats/                概览计数
  mcp/server.ts           官方 SDK 服务端，每个请求一个实例
  mcp client              domain/source/mcp.ts 代理远程 MCP 服务器
  infra/                  加密、错误、出网、上游客户端、日志、数据库
apps/web/src
  router.tsx              TanStack Router；布局路由上做登录守卫
  lib/                    请求封装 + 由 contracts 提供类型的 react-query hooks
  components/             外壳、UI 基础组件、客户端配置、试调用、日志
  pages/                  Overview、Sources、SourceNew、SourceDetail、Chat、Settings
```

## 运行时决策

### HTTP：Hono

小而全、类型友好，它的 Web 标准 `Request`/`Response` 正好就是 MCP SDK 的
`WebStandardStreamableHTTPServerTransport` 需要的输入输出，不需要适配层。

### 数据库：SQLite（libsql + Drizzle）

- 单人单进程，SQLite 是正确答案，不是妥协。
- `@libsql/client` 以普通 npm 包分发预编译二进制，任何 Node 版本 `pnpm install` 都能装，
  不需要 C++ 工具链。
- 启动时设置 `WAL`、`busy_timeout=5000`、`foreign_keys=ON`。
- 迁移自动执行；运维永远不需要手动跑迁移命令。

### 认证：不透明会话

- 密码 → `scrypt` 哈希（Node 内置，无原生依赖）。
- 会话：随机令牌，库里存 `sha256`，Cookie 为 `HttpOnly` + `SameSite=Lax`。
- 带会话的写请求必须带 `x-requested-with: plexus`（纵深防御）。
- 有 `roles` 表，但只 seed 一行 `super_admin`；权限是显式的，而不是再造一套多租户模型。

### 配置

`config.ts` 用 zod 校验所有变量、解析路径、创建 `DATA_DIR`，并在 `DATA_DIR/.secret` 生成
32 字节数据密钥。任何非法值都会在启动时带着字段列表终止。业务代码只 import `config`；
ESLint 禁止在其他地方读 `process.env`。这同时修掉了一类 bug：模块级常量在 `.env` 加载前
就读了环境变量。

## 调用流水线

每一次调用 —— MCP、试调用、助手 —— 都走 `domain/invoke/pipeline.ts`：

```
加载工具 + 应用
  → 应用/工具已启用且已暴露
  → scope 覆盖副作用              （只读令牌不能写）
  → 限流                          （令牌桶，按 令牌 × 工具）
  → 按 JSON Schema 校验参数        （Ajv，每个 schema 只编译一次）
  → 幂等开始                       （仅写操作；三态账本）
  → 构造请求                       （路径参数、query、JSON body、鉴权）
  → 出网检查 + 转发                （固定 IP、不跟随重定向、默认 15s）
  → 幂等收尾
  → 记录调用                       （失败也绝不影响调用结果）
```

几个关键点：

- **SSRF**：DNS 只解析一次，socket 固定到该 IP；HTTP 客户端覆写 `lookup`，TLS 的
  `servername` 仍用真实主机名，重定向直接拒绝。私网地址会被拒绝，除非主机在
  `EGRESS_ALLOW_HOSTS` 里。
- **幂等**：唯一约束 `(scope, key)`，状态为 `done / in_progress / digest mismatch`，
  租约 30 秒，崩溃的调用方可以接管。
- **预览**截断到 2000 字符；上游响应体上限 2 MiB。

## MCP

- **北向**：官方 `@modelcontextprotocol/sdk`，Streamable HTTP，**无状态**：每个请求创建
  一个 server 和 transport，处理完即关闭。没有会话表，没有残留状态。
- **南向**：应用本身也可以是一个 MCP 服务器（`kind = mcp`）。平台用 SDK 客户端连上去，
  导入远端的 `tools/list`，并通过同一条流水线代理 `tools/call` —— 于是一个本地端点可以
  聚合多个远程 MCP 服务器。
- 工具 = 已暴露 ∩ 工具已启用 ∩ 应用已启用；`read` 令牌只能看到只读工具。
- 令牌可以限制到部分应用（`token_apps`）；没有记录表示允许所有应用。
- 工具名稳定：`{app_slug}__{tool}`，`[A-Za-z0-9_-]{1,64}`，冲突时加数字后缀。
- 写结果按推导幂等：客户端没给 key 时使用 `sha256(token | tool | args)`。

## 应用间调用

不是 MCP 客户端的后端可以使用 REST 网关：

```
POST /api/gateway/apps/:id/secret     (仅所有者) -> app_secret，只显示一次
POST /api/gateway/token               {appId, appSecret} -> 短期访问令牌（1 小时）
POST /api/gateway/invoke              Bearer 令牌 + {tool, args} -> 同一条流水线
```

只有已启用应用的已暴露工具可以被调用，每次调用都会在日志里归属到发起应用
（`via=gateway-app`、`actorType=app`）。轮换密钥会让之前签发的令牌立即失效。跨应用调用
还需要**授权**（`app_grants`）：应用永远可以调自己的工具，调别的应用的工具会返回
`403 no_grant`，直到所有者在调用方页面勾选。

## 助手

- 多个会话，都存在 SQLite；侧栏按首条消息自动生成标题。
- OpenAI 兼容的对话，支持**流式文本**和原生工具调用。默认服务商是 DeepSeek；`stub` 提供
  确定性的离线行为，供测试和演示使用。
- 模型配置在**设置 → 模型**（服务商、Base URL、模型、密钥、超时）。密钥用实例数据密钥
  加密，API 永不回显；有「测试连接」动作。环境变量仍是回退值。
- 系统提示词有自己的二级页（`/chat/prompt`），存在 `settings` 表。
- 遇到第一个**写**调用就暂停，并持久化一条 `pending_tool_call`。待确认调用会随会话历史
  一起返回，所以刷新页面能恢复确认卡。同意后继续循环；拒绝会把拒绝结果回传给模型。
- 如果模型一次返回多个工具调用，其中一个写操作之后的那些会收到显式的「已跳过」结果，
  保证每个 `tool_call` 都有对应的 tool 消息。
- 没有 API key 时助手报告 `enabled: false` 并链接到设置页 —— 不会在运行时才失败。

## 错误信封

```json
{ "error": { "code": "invalid_args", "message": "…", "hint": "…", "details": [], "requestId": "…" } }
```

`code` 稳定且机器可读；`message` 给人看；`requestId` 与 `x-request-id` 头和日志行一致。
MCP 会把 code 翻译成建议文案，因为模型读的是这些字符串。

## 前端

四个去处：

| 路由 | 职责 |
|---|---|
| `/` | 端点、令牌状态、今日调用、可复制的客户端配置、最近活动 |
| `/apps` | 导入（3 步）、方法列表、方法级暴露、试调用、单个应用的日志 |
| `/chat` | 内置助手，写操作需确认 |
| `/settings` | 账号、令牌、数据 |

规则：每个列表都有带一个主操作的空状态；危险操作需要输入资源名确认；错误展示
`message` + `hint`；写工具在视觉上有标记。

## 测试

| 层 | 内容 |
|---|---|
| 单元 | 密码/加密、请求构造、SSRF 网段、OpenAPI 映射、命名 |
| 集成 | 流水线对真实本地上游；幂等回放；上游失败 |
| 契约 | 用真实 MCP SDK 客户端连运行中的应用（list + call） |
| 助手 | stub 服务商：读循环、同意、拒绝、重复确认、历史 |
| 端到端 | `scripts/smoke.mjs`：导入 → 暴露 → 试调用 → 令牌 → MCP 调用 → 日志 → 统计 |

## 有意不做的事

- 多租户、组织、RBAC 界面、DLP。
- 独立的 `Grant` 实体：只有一个主体时，它退化成 `tool.exposed` + `token.scope`。
- 审计 outbox worker：这个量级一次插入就够了。
- RS256/JWKS 上下文签名：上游拿到的是 Bearer/Header 凭据。
- 后台任务队列。需要它的功能，先要有一个产品决策。
