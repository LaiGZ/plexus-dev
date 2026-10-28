import { parse as parseYaml } from "yaml";
import { badRequest } from "../../infra/errors.js";
import type { ToolPreview } from "@plexus/contracts";

type JsonObject = Record<string, unknown>;

interface OpenApiDocument extends JsonObject {
  openapi?: string;
  swagger?: string;
  servers?: Array<{ url?: string }>;
  host?: string;
  basePath?: string;
  paths?: Record<string, JsonObject>;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head"] as const;
const MAX_DEPTH = 20;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointer(doc: JsonObject, ref: string): unknown {
  const parts = ref
    .replace(/^#\//, "")
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = doc;
  for (const part of parts) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/** Resolve internal `$ref`s; foreign refs and cycles are reported, never fetched. */
function resolveRefs(
  doc: JsonObject,
  node: unknown,
  warnings: string[],
  seen: Set<string> = new Set(),
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return {};
  if (Array.isArray(node)) return node.map((item) => resolveRefs(doc, item, warnings, seen, depth + 1));
  if (!isObject(node)) return node;

  const ref = node["$ref"];
  if (typeof ref === "string") {
    if (!ref.startsWith("#/")) {
      warnings.push(`Ignored external reference: ${ref}`);
      return {};
    }
    if (seen.has(ref)) return { type: "object", additionalProperties: true };
    const target = pointer(doc, ref);
    if (target === undefined) {
      warnings.push(`Unresolved reference: ${ref}`);
      return {};
    }
    return resolveRefs(doc, target, warnings, new Set([...seen, ref]), depth + 1);
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = resolveRefs(doc, value, warnings, seen, depth + 1);
  }
  return out;
}

function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "tool").slice(0, 48);
}

function operationName(method: string, path: string, operation: JsonObject): string {
  const id = operation["operationId"];
  if (typeof id === "string" && id.trim()) return id.trim();
  return sanitizeName(`${method}_${path.replace(/^\//, "").replace(/[/{}]/g, "_")}`);
}

function describe(operation: JsonObject, method: string, path: string): string {
  const summary = operation["summary"];
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  const description = operation["description"];
  if (typeof description === "string" && description.trim()) return description.trim().slice(0, 500);
  return `${method.toUpperCase()} ${path}`;
}

function resolveBaseUrl(doc: OpenApiDocument, override: string | undefined): string {
  const server = doc.servers?.[0]?.url;
  if (server) {
    if (/^https?:\/\//i.test(server)) return server;
    if (override) return new URL(server, override).toString();
    throw badRequest(
      "The spec uses a relative server URL",
      undefined,
      "Pass baseUrl so relative servers can be resolved",
    );
  }
  if (doc.swagger && typeof doc.host === "string") {
    const scheme = /^https/i.test(override ?? "") ? "https" : "http";
    const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
    return `${scheme}://${doc.host}${basePath}`;
  }
  if (override) return override;
  throw badRequest(
    "The spec does not define a server URL",
    undefined,
    "Add `servers` to the spec or pass baseUrl explicitly",
  );
}

export interface ParsedOpenApi {
  baseUrl: string;
  tools: ToolPreview[];
  warnings: string[];
}

/**
 * Parse an OpenAPI 3.x / Swagger 2.x document into tool drafts.
 *
 * Deliberately conservative: only object-shaped JSON request bodies are merged
 * into the input schema; anything else is reported as a warning instead of
 * producing a tool that would silently send the wrong payload.
 */
export function parseOpenApi(
  text: string,
  options: { baseUrl?: string; mcpNames?: (name: string) => string } = {},
): ParsedOpenApi {
  let doc: OpenApiDocument;
  try {
    const parsed: unknown = parseYaml(text);
    if (!isObject(parsed)) throw new Error("not an object");
    doc = parsed as OpenApiDocument;
  } catch {
    throw badRequest("Spec is not valid JSON or YAML");
  }

  if (!doc.openapi && !doc.swagger) {
    throw badRequest(
      "Not an OpenAPI document",
      undefined,
      "Expected an `openapi` or `swagger` field at the top level",
    );
  }

  const warnings: string[] = [];
  const baseUrl = resolveBaseUrl(doc, options.baseUrl);
  const paths = doc.paths;
  if (!isObject(paths) || Object.keys(paths).length === 0) {
    throw badRequest("The spec has no paths", undefined, "Add at least one operation under `paths`");
  }

  const tools: ToolPreview[] = [];
  const seenNames = new Set<string>();

  for (const [path, rawPathItem] of Object.entries(paths)) {
    if (!isObject(rawPathItem)) continue;

    for (const method of METHODS) {
      const rawOperation = rawPathItem[method];
      if (!isObject(rawOperation)) continue;

      if (rawOperation["deprecated"] === true) {
        warnings.push(`Skipped deprecated operation ${method.toUpperCase()} ${path}`);
        continue;
      }

      const operation = resolveRefs(doc, rawOperation, warnings) as JsonObject;
      const pathItem = resolveRefs(doc, rawPathItem, warnings) as JsonObject;

      const name = operationName(method, path, operation);
      if (seenNames.has(name)) {
        warnings.push(`Skipped duplicate operation name: ${name}`);
        continue;
      }
      seenNames.add(name);

      const parameters = [
        ...(Array.isArray(pathItem["parameters"]) ? pathItem["parameters"] : []),
        ...(Array.isArray(operation["parameters"]) ? operation["parameters"] : []),
      ].map((p) => resolveRefs(doc, p, warnings) as JsonObject);

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const param of parameters) {
        const paramName = param["name"];
        const where = param["in"];
        if (typeof paramName !== "string") continue;
        if (where !== "path" && where !== "query") continue;
        const schema = isObject(param["schema"]) ? param["schema"] : { type: param["type"] ?? "string" };
        properties[paramName] = schema;
        if (param["required"] === true) required.push(paramName);
      }

      let requestBody: unknown;
      const v3Body = operation["requestBody"];
      if (isObject(v3Body)) {
        const content = v3Body["content"];
        if (isObject(content)) {
          const json = content["application/json"];
          if (isObject(json)) requestBody = json["schema"];
          else {
            const first = Object.values(content).find((c) => isObject(c) && isObject(c["schema"]));
            if (isObject(first)) requestBody = first["schema"];
          }
        }
      } else {
        const bodyParam = parameters.find((p) => p["in"] === "body");
        if (bodyParam) requestBody = bodyParam["schema"];
      }

      if (requestBody !== undefined) {
        const schema = resolveRefs(doc, requestBody, warnings) as JsonObject;
        const bodyProps = schema?.["properties"];
        if (isObject(bodyProps)) {
          for (const [key, value] of Object.entries(bodyProps)) {
            if (key in properties) {
              warnings.push(`${name}: body field \`${key}\` shadows a parameter`);
            }
            properties[key] = value;
          }
          if (Array.isArray(schema["required"])) {
            for (const key of schema["required"]) {
              if (typeof key === "string" && !required.includes(key)) required.push(key);
            }
          }
        } else {
          warnings.push(`${name}: non-object request body is not supported and was left out`);
        }
      }

      const inputSchema: JsonObject = { type: "object", properties };
      if (required.length) inputSchema["required"] = required;

      const sideEffect = method === "get" || method === "head" ? "read" : "write";
      const rawName = name.replace(/[^A-Za-z0-9_-]/g, "_");
      tools.push({
        name: rawName,
        mcpName: options.mcpNames ? options.mcpNames(rawName) : rawName,
        description: describe(operation, method, path),
        method: method.toUpperCase(),
        path,
        sideEffect,
        inputSchema,
      });
    }
  }

  if (tools.length === 0) {
    throw badRequest("No supported operations found in the spec", warnings);
  }

  return { baseUrl, tools, warnings };
}
