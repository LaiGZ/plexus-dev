import { badRequest } from "../../infra/errors.js";

export interface AuthConfig {
  type: "none" | "bearer" | "basic" | "header";
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
}

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const PATH_PARAM = /\{([^}]+)\}/g;

function parseHeaders(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function applyAuth(headers: Record<string, string>, auth: AuthConfig | null | undefined): void {
  if (!auth || auth.type === "none") return;
  if (auth.type === "bearer" && auth.token) {
    headers.authorization = `Bearer ${auth.token}`;
    return;
  }
  if (auth.type === "basic" && auth.username !== undefined) {
    const raw = `${auth.username}:${auth.password ?? ""}`;
    headers.authorization = `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
    return;
  }
  if (auth.type === "header" && auth.headerName) {
    headers[auth.headerName] = auth.headerValue ?? "";
  }
}

function queryValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * Turn tool arguments into an HTTP request.
 *
 * - `{name}` placeholders in the path are substituted (URL-encoded) and removed
 *   from the remaining arguments.
 * - GET/HEAD/DELETE send everything else as query parameters.
 * - Other methods send everything else as a JSON body.
 */
export function buildUpstreamRequest(input: {
  baseUrl: string;
  method: string;
  path: string;
  args: Record<string, unknown>;
  headers?: string | null;
  auth?: AuthConfig | null;
}): BuiltRequest {
  const method = input.method.toUpperCase();
  const remaining: Record<string, unknown> = { ...input.args };
  const used = new Set<string>();

  const path = input.path.replace(PATH_PARAM, (_match, rawName: string) => {
    const name = rawName.trim();
    const value = input.args[name];
    if (value === undefined || value === null || value === "") {
      throw badRequest(`Missing path parameter: ${name}`);
    }
    used.add(name);
    return encodeURIComponent(String(value));
  });
  for (const name of used) delete remaining[name];

  let url: string;
  if (/^https?:\/\//i.test(path)) {
    url = path;
  } else {
    url = `${input.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    ...parseHeaders(input.headers),
  };
  applyAuth(headers, input.auth);

  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
  if (!hasBody) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(remaining)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) query.append(key, queryValue(item));
      } else {
        query.set(key, queryValue(value));
      }
    }
    const qs = query.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    return { url, method, headers };
  }

  headers["content-type"] = headers["content-type"] ?? "application/json";
  return {
    url,
    method,
    headers,
    body: JSON.stringify(remaining),
  };
}
