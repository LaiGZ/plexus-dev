import { describe, expect, it } from "vitest";
import { APP_TEMPLATE, parseAppTemplate, templatePreview } from "./template.js";

describe("app templates", () => {
  it("ships a template that parses", () => {
    const template = parseAppTemplate(APP_TEMPLATE);
    expect(template.format).toBe("plexus.template.v1");
    expect(template.app.name).toBe("Finance");
    expect(template.tools.map((tool) => tool.name)).toEqual(["listBills", "createBill"]);
  });

  it("previews a template without an app id", () => {
    const template = parseAppTemplate(`
format: plexus.template.v1
app:
  name: Demo API
  baseUrl: https://api.example.com
tools:
  - name: ping
    description: Ping
    method: GET
    path: /ping
    sideEffect: read
    exposed: true
`);
    const preview = templatePreview(template);
    expect(preview.app.name).toBe("Demo API");
    expect(preview.tools[0]?.mcpName).toBe("demo-api__ping");
    expect(preview.tools[0]?.sideEffect).toBe("read");
    expect(preview.warnings).toEqual([]);
  });

  it("accepts JSON as well as YAML", () => {
    const template = parseAppTemplate(
      JSON.stringify({
        format: "plexus.template.v1",
        app: { name: "Json API", baseUrl: "https://api.example.com" },
        tools: [{ name: "a", method: "POST", path: "/a", sideEffect: "write" }],
      }),
    );
    expect(template.app.name).toBe("Json API");
  });

  it("warns when the template carries credentials", () => {
    const template = parseAppTemplate(`
format: plexus.template.v1
app:
  name: Auth API
  baseUrl: https://api.example.com
  auth:
    type: bearer
    token: sk-test
tools:
  - name: ping
    method: GET
    path: /ping
    sideEffect: read
`);
    expect(templatePreview(template).warnings.join(" ")).toContain("credentials");
  });

  it("rejects duplicate method names", () => {
    expect(() =>
      parseAppTemplate(`
format: plexus.template.v1
app:
  name: Dup
  baseUrl: https://api.example.com
tools:
  - { name: a, method: GET, path: /a, sideEffect: read }
  - { name: a, method: GET, path: /b, sideEffect: read }
`),
    ).toThrow(/Duplicate method/);
  });

  it("rejects templates missing the app block", () => {
    expect(() => parseAppTemplate("format: plexus.template.v1\ntools: []\n")).toThrow(
      /missing required fields/,
    );
  });
});
