import { describe, expect, it } from "vitest";
import { parseOpenApi } from "./openapi.js";

const SPEC = `
openapi: 3.0.3
info: { title: Todo API, version: "1.0" }
servers:
  - url: https://api.example.com/v1
components:
  schemas:
    Todo:
      type: object
      properties:
        id: { type: string }
        title: { type: string }
      required: [id]
paths:
  /todos:
    get:
      operationId: listTodos
      summary: List todos
      parameters:
        - name: tag
          in: query
          schema: { type: string }
    post:
      operationId: createTodo
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Todo"
  /todos/{id}:
    get:
      operationId: getTodo
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
    delete:
      operationId: deleteTodo
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
  /legacy:
    get:
      operationId: legacy
      deprecated: true
`;

describe("parseOpenApi", () => {
  const parsed = parseOpenApi(SPEC);

  it("derives the base URL from servers", () => {
    expect(parsed.baseUrl).toBe("https://api.example.com/v1");
  });

  it("maps operations to tools with the right method and side effect", () => {
    const byName = new Map(parsed.tools.map((t) => [t.name, t]));
    expect(byName.get("listTodos")?.sideEffect).toBe("read");
    expect(byName.get("createTodo")?.sideEffect).toBe("write");
    expect(byName.get("deleteTodo")?.sideEffect).toBe("write");
    expect(byName.get("createTodo")?.method).toBe("POST");
    expect(byName.get("getTodo")?.path).toBe("/todos/{id}");
  });

  it("merges parameters and body properties into one input schema", () => {
    const schema = parsed.tools.find((t) => t.name === "createTodo")?.inputSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(["id", "title"]);
    expect(schema.required).toContain("id");
  });

  it("keeps required path parameters", () => {
    const schema = parsed.tools.find((t) => t.name === "getTodo")?.inputSchema as {
      required?: string[];
    };
    expect(schema.required).toEqual(["id"]);
  });

  it("skips deprecated operations", () => {
    expect(parsed.tools.some((t) => t.name === "legacy")).toBe(false);
  });

  it("resolves cycles without exploding", () => {
    const cyclic = `
openapi: 3.0.0
servers: [{ url: "https://api.example.com" }]
components:
  schemas:
    Node:
      type: object
      properties:
        child: { $ref: "#/components/schemas/Node" }
paths:
  /node:
    post:
      operationId: createNode
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Node" }
`;
    const result = parseOpenApi(cyclic);
    expect(result.tools[0]?.name).toBe("createNode");
  });

  it("rejects documents without a server and without baseUrl", () => {
    expect(() =>
      parseOpenApi(`
openapi: 3.0.0
paths:
  /x:
    get: { operationId: x }
`),
    ).toThrow(/server URL/);
  });
});
