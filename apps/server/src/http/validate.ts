import type { Context } from "hono";
import { z } from "zod";
import { badRequest } from "../infra/errors.js";

/** Parse + validate a JSON body, converting Zod issues into the standard error shape. */
export async function readJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body is not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      "Invalid request payload",
      parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "(root)",
        message: i.message,
        code: i.code,
      })),
      "Check field names, types and required values",
    );
  }
  return parsed.data;
}

export function clientIp(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
    const real = c.req.header("x-real-ip");
    if (real) return real;
  }
  return null;
}
