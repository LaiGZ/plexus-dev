/**
 * Register the three demo apps in a running Plexus instance.
 *
 *   BASE_URL=http://127.0.0.1:3000 PLEXUS_ADMIN_PASSWORD=... \
 *   node scripts/connect-demo-apps.mjs
 *
 * Writes each demo's .env (app id + secret) and grants the cross-app calls.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = process.env.PLEXUS_ADMIN_PASSWORD ?? "plexus-dev-123";
const DEMO_ROOT = process.env.DEMO_ROOT ?? "D:/laigz/plexus-demo-apps";
let cookie = "";

async function api(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  headers.set("x-requested-with", "plexus");
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text}`);
  return body;
}

const emptySchema = { type: "object", properties: {} };

const APPS = [
  {
    dir: "finance",
    name: "Finance",
    port: 7001,
    tools: [
      { name: "listBills", method: "POST", path: "/api/listBills", sideEffect: "read", description: "查询账单列表", inputSchema: emptySchema },
      {
        name: "getBill",
        method: "POST",
        path: "/api/getBill",
        sideEffect: "read",
        description: "按编号查询账单",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
      {
        name: "createBill",
        method: "POST",
        path: "/api/createBill",
        sideEffect: "write",
        description: "新建账单（项目记花费时由项目应用调用）",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            projectName: { type: "string" },
            amount: { type: "number" },
            note: { type: "string" },
          },
          required: ["amount"],
        },
      },
    ],
  },
  {
    dir: "project",
    name: "Project",
    port: 7002,
    tools: [
      { name: "listProjects", method: "POST", path: "/api/listProjects", sideEffect: "read", description: "查询项目列表", inputSchema: emptySchema },
      {
        name: "createProject",
        method: "POST",
        path: "/api/createProject",
        sideEffect: "write",
        description: "新建项目",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" }, budget: { type: "number" } },
          required: ["name"],
        },
      },
      {
        name: "listExpenses",
        method: "POST",
        path: "/api/listExpenses",
        sideEffect: "read",
        description: "查询项目花费",
        inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
      },
      {
        name: "addExpense",
        method: "POST",
        path: "/api/addExpense",
        sideEffect: "write",
        description: "记录项目花费（自动在财务应用生成账单）",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            amount: { type: "number" },
            note: { type: "string" },
          },
          required: ["projectId", "amount"],
        },
      },
    ],
  },
  {
    dir: "report",
    name: "Report",
    port: 7003,
    tools: [
      {
        name: "reportSummary",
        method: "POST",
        path: "/api/reportSummary",
        sideEffect: "read",
        description: "汇总各项目的花费与账单（跨应用读取）",
        inputSchema: emptySchema,
      },
    ],
  },
];

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "plexus" },
    body: JSON.stringify({ username: "plexus", password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${await res.text()}`);
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  cookie = cookies.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

async function ensureApp(app) {
  const existing = await api("/api/sources");
  const found = existing.sources.find((source) => source.name === app.name);
  let id;
  if (found) {
    id = found.id;
    console.log(`· ${app.name}: reusing ${id}`);
  } else {
    const created = await api("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: app.name,
        kind: "http",
        baseUrl: `http://127.0.0.1:${app.port}`,
        auth: { type: "none" },
        headers: {},
        exposeAll: true,
        tools: app.tools,
      }),
    });
    id = created.source.id;
    console.log(`+ ${app.name}: created ${id} with ${app.tools.length} methods`);
  }

  const detail = await api(`/api/sources/${id}`);
  const byName = new Map(detail.tools.map((tool) => [tool.name, tool.id]));
  for (const tool of app.tools) {
    if (!byName.has(tool.name)) {
      console.warn(`  ! ${app.name}.${tool.name} is missing (was the app created elsewhere?)`);
    }
  }

  const secret = await api(`/api/gateway/apps/${id}/secret`, { method: "POST" });
  const env = [
    `PLATFORM_BASE=${BASE}`,
    `PUBLIC_URL=http://127.0.0.1:${app.port}`,
    `APP_ID=${id}`,
    `APP_SECRET=${secret.secret}`,
    `PORT=${app.port}`,
    "",
  ].join("\n");
  writeFileSync(resolve(DEMO_ROOT, app.dir, ".env"), env, "utf8");

  return { id, byName };
}

async function main() {
  await login();
  console.log(`Connected to ${BASE}`);

  const ids = {};
  for (const app of APPS) {
    ids[app.name] = await ensureApp(app);
  }

  const grant = async (appName, toolRefs) => {
    const app = ids[appName];
    const toolIds = toolRefs
      .map((ref) => {
        const [owner, tool] = ref.split(".");
        return ids[owner]?.byName.get(tool);
      })
      .filter(Boolean);
    await api(`/api/sources/${app.id}/grants`, {
      method: "PUT",
      body: JSON.stringify({ toolIds }),
    });
    console.log(`✓ ${appName} may call: ${toolRefs.join(", ")}`);
  };

  await grant("Project", ["Finance.createBill"]);
  await grant("Report", ["Finance.listBills", "Project.listProjects", "Project.listExpenses"]);

  console.log("\n.env files updated. Restart the demos:");
  console.log("  cd D:/laigz/plexus-demo-apps/finance && npm start");
  console.log("  cd D:/laigz/plexus-demo-apps/project && npm start");
  console.log("  cd D:/laigz/plexus-demo-apps/report  && npm start");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
