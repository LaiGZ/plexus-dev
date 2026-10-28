import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "../../infra/egress.js";
import { buildUpstreamRequest } from "./request-builder.js";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"])(
    "allows public %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe("buildUpstreamRequest", () => {
  const base = {
    baseUrl: "https://api.example.com/v1",
    method: "GET",
    path: "/todos/{id}",
    headers: null,
    auth: null,
  };

  it("substitutes and URL-encodes path parameters", () => {
    const built = buildUpstreamRequest({ ...base, args: { id: "a b/c", verbose: true } });
    expect(built.url).toBe("https://api.example.com/v1/todos/a%20b%2Fc?verbose=true");
    expect(built.method).toBe("GET");
    expect(built.body).toBeUndefined();
  });

  it("sends remaining arguments as a JSON body for POST", () => {
    const built = buildUpstreamRequest({
      ...base,
      method: "POST",
      path: "/todos",
      args: { title: "write docs", done: false },
    });
    expect(built.url).toBe("https://api.example.com/v1/todos");
    expect(built.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(built.body ?? "{}")).toEqual({ title: "write docs", done: false });
  });

  it("refuses to call with a missing path parameter", () => {
    expect(() => buildUpstreamRequest({ ...base, args: {} })).toThrow(/Missing path parameter/);
  });

  it("applies bearer auth and custom headers", () => {
    const built = buildUpstreamRequest({
      ...base,
      method: "POST",
      path: "/todos",
      args: {},
      headers: JSON.stringify({ "x-tenant": "personal" }),
      auth: { type: "bearer", token: "secret" },
    });
    expect(built.headers.authorization).toBe("Bearer secret");
    expect(built.headers["x-tenant"]).toBe("personal");
  });

  it("expands array query parameters", () => {
    const built = buildUpstreamRequest({
      ...base,
      path: "/todos",
      args: { tag: ["a", "b"] },
    });
    expect(built.url).toBe("https://api.example.com/v1/todos?tag=a&tag=b");
  });
});
