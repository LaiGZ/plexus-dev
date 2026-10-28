import { z } from "zod";

export const Id = z.string().min(1).max(64);
export const Scope = z.enum(["read", "write"]);
export type Scope = z.infer<typeof Scope>;

export const SideEffect = z.enum(["read", "write"]);
export type SideEffect = z.infer<typeof SideEffect>;

export const JsonArgs = z.record(z.unknown());

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** ISO-8601 string as returned by the API for Date fields. */
export const IsoDate = z.string();
