import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { assertEgressAllowed } from "./egress.js";
import { upstreamRedirect, upstreamTimeout, upstreamUnreachable } from "./errors.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface UpstreamRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface UpstreamResponse {
  status: number;
  ok: boolean;
  text: string;
  truncated: boolean;
  headers: Record<string, string>;
}

function headerObject(raw: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

interface PinnedRequestOptions extends RequestOptions {
  lookup?: (
    hostname: string,
    options: unknown,
    callback: (err: Error | null, address: string, family: number) => void,
  ) => void;
  servername?: string;
}

/**
 * Send one request to an upstream under the egress policy.
 *
 * - DNS is resolved once by `assertEgressAllowed`; the socket is pinned to that IP
 *   and `Host` + TLS SNI stay on the original hostname (no rebinding window).
 * - Redirects are never followed: 3xx is surfaced as `upstream_redirect`.
 * - The body is capped at 2 MiB and the cap is reported to the caller.
 */
export async function fetchUpstream(req: UpstreamRequest): Promise<UpstreamResponse> {
  const decision = await assertEgressAllowed(req.url);
  const url = decision.url;
  const isHttps = url.protocol === "https:";
  const port = url.port || (isHttps ? "443" : "80");

  const options: PinnedRequestOptions = {
    method: req.method,
    hostname: url.hostname,
    port,
    path: `${url.pathname}${url.search}`,
    headers: { ...req.headers, host: url.host },
    lookup: (_hostname, _options, callback) => {
      callback(null, decision.address, decision.family);
    },
    servername: url.hostname,
    timeout: req.timeoutMs,
  };

  return new Promise<UpstreamResponse>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (value: UpstreamResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const send = isHttps ? httpsRequest : httpRequest;
    const clientRequest = send(options, (res) => {
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400) {
        res.resume();
        fail(upstreamRedirect(status));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;

      const finish = () => {
        succeed({
          status,
          ok: status >= 200 && status < 300,
          text: Buffer.concat(chunks).toString("utf8"),
          truncated,
          headers: headerObject(res.headers),
        });
      };

      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          truncated = true;
          res.destroy();
          finish();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", finish);
      res.on("error", (err) => fail(upstreamUnreachable(err.message)));
    });

    clientRequest.on("timeout", () => {
      clientRequest.destroy();
      fail(upstreamTimeout());
    });
    clientRequest.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ETIMEDOUT") fail(upstreamTimeout());
      else fail(upstreamUnreachable(err.message));
    });

    if (req.body !== undefined) clientRequest.write(req.body);
    clientRequest.end();
  });
}
