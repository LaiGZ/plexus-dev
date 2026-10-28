export interface ApiErrorBody {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body?: ApiErrorBody,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  // Required by the server's CSRF guard for mutating requests.
  headers.set("x-requested-with", "plexus");

  const res = await fetch(path, { credentials: "include", ...init, headers });
  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const body = (payload as { error?: ApiErrorBody } | null)?.error;
    throw new ApiError(body?.message ?? "Request failed", res.status, body?.code ?? "internal", body);
  }
  return payload as T;
}

export interface MeResponse {
  user: {
    id: string;
    username: string;
    role: { key: string; name: string; permissions: string[] };
    mustChangePassword: boolean;
  };
}

export interface MetaResponse {
  product: string;
  version: string;
  initialized: boolean;
  publicUrl: string;
  mcpEndpoint: string;
}
