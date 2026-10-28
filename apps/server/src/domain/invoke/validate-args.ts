import AjvModule from "ajv";
import { AppError, invalidArgs } from "../../infra/errors.js";

interface ValidationIssue {
  instancePath: string;
  message?: string;
  keyword: string;
}

interface ValidateFunction {
  (data: unknown): boolean;
  errors?: ValidationIssue[] | null;
}

const Ajv = AjvModule as unknown as new (options?: Record<string, unknown>) => {
  compile: (schema: object) => ValidateFunction;
};

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
const cache = new Map<string, ValidateFunction>();

function compile(schemaJson: string): ValidateFunction {
  const cached = cache.get(schemaJson);
  if (cached) return cached;

  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaJson);
  } catch {
    throw new AppError("tool_schema_invalid", 500, "Tool input schema is not valid JSON");
  }
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(parsed as object);
  } catch (err) {
    throw new AppError(
      "tool_schema_invalid",
      500,
      "Tool input schema could not be compiled",
      err instanceof Error ? err.message : undefined,
    );
  }
  cache.set(schemaJson, validate);
  return validate;
}

/** Enforce the tool contract before anything leaves the gateway. */
export function validateToolArgs(schemaJson: string, args: unknown): void {
  const validate = compile(schemaJson);
  if (validate(args)) return;

  const issues = (validate.errors ?? []).map((e) => ({
    path: e.instancePath.replace(/^\//, "").replace(/\//g, ".") || "(root)",
    message: e.message ?? "invalid",
    keyword: e.keyword,
  }));
  throw invalidArgs(issues);
}
