import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config.js";
import { egressBlocked, badRequest } from "./errors.js";

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./,
  /^198\.(18|19)\./,
  /^2[2-5]\d\./,
];

const PRIVATE_V6 = [/^::1?$/i, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i, /^::ffff:/i, /^ff/i];

/** True for loopback, private, link-local, CGNAT and other non-public ranges. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (family === 6) return PRIVATE_V6.some((re) => re.test(ip));
  return true;
}

export interface EgressDecision {
  url: URL;
  address: string;
  family: 4 | 6;
  /** True when the host is explicitly allow-listed (local development upstreams). */
  devAllowed: boolean;
}

/**
 * Resolve the destination exactly once and decide whether we may connect.
 *
 * The resolved IP is returned so the HTTP client can pin it: checking DNS and
 * then re-resolving in `fetch` would leave a DNS-rebinding window (TOCTOU).
 */
export async function assertEgressAllowed(
  rawUrl: string,
  allowedHosts: string[] = config.egressAllowHosts,
): Promise<EgressDecision> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw badRequest("Upstream URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest("Only http and https upstreams are supported");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const devAllowed = allowedHosts.includes(host);

  if (!devAllowed) {
    if (url.protocol !== "https:") {
      throw badRequest("Public upstreams must use https", undefined, "Use https:// or allow-list the host");
    }
    const port = url.port ? Number(url.port) : 443;
    if (port < 1024 && port !== 80 && port !== 443) {
      throw egressBlocked(`Port ${port} is not allowed for public upstreams`);
    }
  }

  let address: string;
  let family: 4 | 6;
  if (isIP(host) !== 0) {
    address = host;
    family = isIP(host) === 6 ? 6 : 4;
  } else {
    let result: Array<{ address: string; family: number }>;
    try {
      result = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw egressBlocked(`Could not resolve ${host}`, "Check the host name or your DNS settings");
    }
    const first = result[0];
    if (!first) throw egressBlocked(`Could not resolve ${host}`);
    address = first.address;
    family = first.family === 6 ? 6 : 4;
  }

  if (!devAllowed && isPrivateAddress(address)) {
    throw egressBlocked(
      `${host} resolves to a private address (${address})`,
      "Private destinations are blocked to prevent SSRF; allow-list the host for local upstreams",
    );
  }

  return { url, address, family, devAllowed };
}
