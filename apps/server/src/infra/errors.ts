/**
 * One error type for the whole server.
 *
 * Response shape is always `{ error: { code, message, hint?, details?, requestId } }`
 * where `message` is human readable and `code` is stable and machine readable.
 */

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal"
  | "egress_blocked"
  | "upstream_error"
  | "upstream_timeout"
  | "upstream_unreachable"
  | "upstream_redirect"
  | "tool_not_exposed"
  | "source_disabled"
  | "read_only_token"
  | "invalid_args"
  | "tool_schema_invalid"
  | "idempotency_mismatch"
  | "idempotency_in_progress"
  | "invalid_password"
  | "password_policy";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 504;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: ErrorStatus,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown, hint?: string) =>
  new AppError("invalid_request", 400, message, hint, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError("unauthorized", 401, message);

export const forbidden = (message: string, hint?: string) =>
  new AppError("forbidden", 403, message, hint);

export const notFound = (message: string) => new AppError("not_found", 404, message);

export const conflict = (message: string, hint?: string) =>
  new AppError("conflict", 409, message, hint);

export const rateLimited = (message = "Too many attempts, try again later") =>
  new AppError("rate_limited", 429, message);

export const invalidArgs = (issues: unknown) =>
  new AppError(
    "invalid_args",
    400,
    "Arguments do not match the tool schema",
    "Check the tool's input schema; `details` lists each failing path",
    issues,
  );

export const egressBlocked = (
  message = "Destination is not allowed by the egress policy",
  hint = "Private and link-local addresses are blocked; add the host to EGRESS_ALLOW_HOSTS for local upstreams",
) => new AppError("egress_blocked", 403, message, hint);

export const readOnlyToken = () =>
  new AppError(
    "read_only_token",
    403,
    "This token is read-only and cannot call a tool that modifies data",
    "Create a token with scope=write to allow writes",
  );

export const upstreamError = (status: number, detail?: string) =>
  new AppError(
    "upstream_error",
    502,
    `Upstream responded with HTTP ${status}`,
    detail,
  );

export const upstreamTimeout = () =>
  new AppError("upstream_timeout", 504, "Upstream did not respond in time", "Increase UPSTREAM_TIMEOUT_MS or check the upstream service");

export const upstreamRedirect = (status: number) =>
  new AppError(
    "upstream_redirect",
    502,
    `Upstream responded with a redirect (HTTP ${status})`,
    "The gateway never follows redirects; point the tool at the final URL",
  );

export const upstreamUnreachable = (message = "Upstream is unreachable") =>
  new AppError("upstream_unreachable", 502, message);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
