/**
 * End-to-end smoke test against a running Plexus instance and the example mock API.
 *
 *   PORT=3102 DATA_DIR=./.tmp/smoke node apps/server/dist/index.js &
 *   PORT=7100 node examples/mock-api.mjs &
 *   BASE_URL=http://127.0.0.1:3102 PLEXUS_ADMIN_PASSWORD=... node scripts/smoke.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const MOCK = process.env.MOCK_API_URL ?? "http://127.0.0.1:7100";
const USERNAME = process.env.PLEXUS_ADMIN_USERNAME ?? "plexus";
const PASSWORD = process.env.PLEXUS_ADMIN_PASSWORD ?? "smoke-password-123";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let cookie = "";

function ok(message) {
  console.log(`  \u2713 ${message}`);
}

function fail(message, detail) {
  console.error(`  \u2717 ${message}`);
  if (detail !== undefined) console.error(detail);
  process.exit(1);
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  headers.set("x-requested-with", "plexus");
  if (cookie) headers.set("cookie", cookie);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 204) return null;
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    fail(`${init.method ?? "GET"} ${path} -> ${res.status}`, body);
  }
  return body;
}

async function mcp(token, payload) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) fail(`MCP ${payload.method} -> ${res.status}`, text);
  return JSON.parse(text);
}

console.log(`\nPlexus smoke test → ${BASE}\n`);

// 1. health
const health = await call("/healthz");
if (!health?.ok) fail("health check failed", health);
ok("healthz reports ok");

// 2. login
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-requested-with": "plexus" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
});
if (!login.ok) fail("login failed", await login.text());
const cookies = login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""];
cookie = cookies.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
if (!cookie.includes("px_session=")) fail("login did not set a session cookie");
ok("login succeeded");

// 3. preview an OpenAPI document
const spec = readFileSync(resolve(root, "examples/openapi/todo.yaml"), "utf8").replaceAll(
  "http://127.0.0.1:7100",
  MOCK,
);
const preview = await call("/api/sources/preview", {
  method: "POST",
  body: JSON.stringify({ kind: "openapi", name: "Smoke Todo", specText: spec, auth: { type: "none" } }),
});
if (preview.tools.length !== 3) fail(`expected 3 tools, got ${preview.tools.length}`, preview);
ok(`preview found ${preview.tools.length} tools at ${preview.baseUrl}`);

// 4. create the source
const created = await call("/api/sources", {
  method: "POST",
  body: JSON.stringify({
    name: "Smoke Todo",
    kind: "openapi",
    baseUrl: preview.baseUrl,
    auth: { type: "none" },
    headers: {},
    tools: preview.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      method: tool.method,
      path: tool.path,
      sideEffect: tool.sideEffect,
      inputSchema: tool.inputSchema,
    })),
  }),
});
const sourceId = created.source.id;
if (created.tools.length !== 3) fail("source was not created with 3 tools", created);
ok(`source created (${sourceId})`);

// 5. expose two tools
const listTool = created.tools.find((tool) => tool.name === "listTodos");
const createTool = created.tools.find((tool) => tool.name === "createTodo");
if (!listTool || !createTool) fail("expected listTodos and createTodo", created.tools);
for (const tool of [listTool, createTool]) {
  await call(`/api/tools/${tool.id}`, {
    method: "PATCH",
    body: JSON.stringify({ exposed: true }),
  });
}
ok("two tools exposed");

// 6. try it from the console
const tried = await call(`/api/tools/${listTool.id}/try`, {
  method: "POST",
  body: JSON.stringify({ args: {} }),
});
if (!Array.isArray(tried.data?.todos) || tried.data.todos.length === 0) {
  fail("try-it did not return todos", tried);
}
ok(`try-it returned ${tried.data.todos.length} todos in ${tried.latencyMs}ms`);

// 7. token + MCP round trip
const tokenResult = await call("/api/tokens", {
  method: "POST",
  body: JSON.stringify({ name: "smoke", scope: "write" }),
});
const token = tokenResult.token;

const init = await mcp(token, {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "plexus-smoke", version: "0.0.0" },
  },
});
if (!init.result?.serverInfo?.name) fail("MCP initialize failed", init);
ok(`MCP initialized (${init.result.serverInfo.name} ${init.result.serverInfo.version})`);

const listed = await mcp(token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
const names = listed.result.tools.map((tool) => tool.name);
for (const expected of [listTool.mcpName, createTool.mcpName]) {
  if (!names.includes(expected)) fail(`MCP tools/list is missing ${expected}`, names);
}
ok(`MCP lists ${names.length} tools`);

const callPayload = {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: createTool.mcpName,
    arguments: { title: `created by smoke ${Date.now()}` },
  },
};
const first = await mcp(token, callPayload);
if (first.result?.isError) fail("MCP tools/call returned an error", first);
ok("MCP tools/call succeeded");

const replay = await mcp(token, { ...callPayload, id: 4 });
if (JSON.stringify(replay.result) !== JSON.stringify(first.result)) {
  fail("identical MCP call was not replayed", { first, replay });
}
ok("identical MCP call replayed (idempotency)");

// 8. logs and stats
const invocations = await call("/api/invocations?limit=20");
if (invocations.invocations.length < 2) fail("invocations were not recorded", invocations);
ok(`${invocations.invocations.length} invocations recorded`);

const stats = await call("/api/stats");
if (stats.exposedTools !== 2) fail(`expected 2 exposed tools, got ${stats.exposedTools}`, stats);
ok(`stats: ${stats.tools} tools, ${stats.exposedTools} exposed, ${stats.invocationsToday} calls today`);

// 9. a second app defined by hand: multiple methods, exposed on creation
const manual = await call("/api/sources", {
  method: "POST",
  body: JSON.stringify({
    name: "Manual App",
    kind: "http",
    baseUrl: MOCK,
    auth: { type: "none" },
    headers: {},
    exposeAll: true,
    tools: [
      { name: "health", description: "Health check", method: "GET", path: "/health", sideEffect: "read" },
      {
        name: "quickTodo",
        description: "Create a todo",
        method: "POST",
        path: "/todos",
        sideEffect: "write",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
    ],
  }),
});
if (manual.tools.length !== 2 || manual.source.exposedCount !== 2) {
  fail("manual app was not created with 2 exposed methods", manual);
}
ok("manual app exposed 2 methods on creation");

const manualMcp = await mcp(token, { jsonrpc: "2.0", id: 10, method: "tools/list" });
const manualNames = manualMcp.result.tools.map((tool) => tool.name);
const manualWrite = manual.tools.find((tool) => tool.name === "quickTodo");
if (!manualWrite || !manualNames.includes(manualWrite.mcpName)) {
  fail("manual methods are missing from MCP", manualNames);
}
ok("manual methods are callable over MCP");

// 10. app credentials → service token → /gateway/invoke
const secretRes = await call(`/api/gateway/apps/${manual.source.id}/secret`, { method: "POST" });
if (!secretRes.secret?.startsWith("pxa_")) fail("app secret was not issued", secretRes);

const tokenRes = await fetch(`${BASE}/api/gateway/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ appId: manual.source.id, appSecret: secretRes.secret }),
});
if (!tokenRes.ok) fail("app token exchange failed", await tokenRes.text());
const appToken = await tokenRes.json();

const invokeRes = await fetch(`${BASE}/api/gateway/invoke`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${appToken.accessToken}`,
  },
  body: JSON.stringify({ tool: manualWrite.mcpName, args: { title: "created by app" } }),
});
if (invokeRes.status !== 201) fail(`gateway invoke -> ${invokeRes.status}`, await invokeRes.text());
const invoked = await invokeRes.json();
if (invoked.data?.title !== "created by app") fail("gateway invoke returned no data", invoked);
ok("app credentials exchanged and /gateway/invoke worked");

// 11. assistant (requires MODEL_PROVIDER=stub)
async function sse(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "plexus",
      cookie,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`${path} -> ${res.status}`, text);
  const events = [];
  for (const frame of text.split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (data) {
      try {
        events.push(JSON.parse(data));
      } catch {
        // ignore keep-alive frames
      }
    }
  }
  return events;
}

const agentStatus = await call("/api/agent/status");
if (agentStatus.enabled && agentStatus.provider === "stub") {
  const conversations = await call("/api/agent/conversations");
  let conversationId = conversations.conversations[0]?.id;
  if (!conversationId) {
    const createdConversation = await call("/api/agent/conversations", { method: "POST" });
    conversationId = createdConversation.conversation.id;
  }

  const agentPrompt = await call("/api/agent/prompt");
  if (!agentPrompt.systemPrompt) fail("assistant prompt is empty", agentPrompt);
  ok("assistant prompt is available");

  const modelConfig = await call("/api/agent/model");
  if (typeof modelConfig.provider !== "string") fail("model config is missing", modelConfig);
  ok(`model config: ${modelConfig.provider} / ${modelConfig.model}`);

  const readEvents = await sse("/api/agent/chat", {
    conversationId,
    message: "please read my todos",
  });
  if (!readEvents.some((event) => event.type === "tool_result" && event.ok)) {
    fail("assistant did not run a read tool", readEvents);
  }
  if (!readEvents.some((event) => event.type === "assistant_delta")) {
    fail("assistant did not stream text", readEvents);
  }
  ok("assistant ran a read tool");

  const writeEvents = await sse("/api/agent/chat", {
    conversationId,
    message: "please create a todo called from smoke",
  });
  const confirm = writeEvents.find((event) => event.type === "confirm_request");
  if (!confirm) fail("assistant did not ask for write confirmation", writeEvents);
  ok("assistant paused for write approval");

  const confirmEvents = await sse("/api/agent/confirm", {
    pendingId: confirm.pendingId,
    approved: true,
  });
  if (!confirmEvents.some((event) => event.type === "tool_result" && event.ok)) {
    fail("approved write did not execute", confirmEvents);
  }
  ok("approved write executed");

  const chatHistory = await call(`/api/agent/conversations/${conversationId}/messages`);
  if (!chatHistory.messages.some((message) => message.role === "user")) {
    fail("assistant history is empty", chatHistory);
  }
  if (chatHistory.pending !== null) {
    fail("pending confirmation was not cleared after approval", chatHistory);
  }
  ok(`assistant history has ${chatHistory.messages.length} messages`);

  const conversationList = await call("/api/agent/conversations");
  if (!conversationList.conversations.some((item) => item.id === conversationId)) {
    fail("conversation is missing from the list", conversationList);
  }
  ok("conversation appears in the list");
} else {
  console.log("  - assistant checks skipped (MODEL_PROVIDER is not stub)");
}

console.log("\nAll smoke checks passed.\n");
