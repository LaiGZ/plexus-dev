/**
 * Tiny upstream API used by the docs, the smoke test, and local demos.
 *
 *   PORT=7100 node examples/mock-api.mjs
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 7100);
let todos = [
  { id: "1", title: "Write the docs", done: false },
  { id: "2", title: "Ship it", done: false },
];
let nextId = 3;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/todos") {
    return send(res, 200, { todos });
  }

  if (req.method === "POST" && url.pathname === "/todos") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return send(res, 400, { error: "invalid_json" });
      }
      if (typeof body.title !== "string" || !body.title.trim()) {
        return send(res, 422, { error: "title_required" });
      }
      const todo = { id: String(nextId++), title: body.title.trim(), done: false };
      todos = [...todos, todo];
      return send(res, 201, todo);
    });
    return;
  }

  const match = /^\/todos\/([^/]+)$/.exec(url.pathname);
  if (match && req.method === "GET") {
    const todo = todos.find((item) => item.id === match[1]);
    return todo ? send(res, 200, todo) : send(res, 404, { error: "not_found" });
  }

  send(res, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock api listening on http://127.0.0.1:${port}`);
});
