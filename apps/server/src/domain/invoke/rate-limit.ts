import { config } from "../../config.js";
import { rateLimited } from "../../infra/errors.js";

interface Bucket {
  tokens: number;
  ts: number;
}

/**
 * In-memory token bucket. Plexus is a single-process server by design; this is
 * documented in the deployment notes rather than replaced with a distributed limiter.
 */
const buckets = new Map<string, Bucket>();

export function takeRateLimitToken(key: string, perSec = config.rateLimitPerSec): void {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: perSec, ts: now };
  const elapsed = (now - bucket.ts) / 1000;
  bucket.tokens = Math.min(perSec, bucket.tokens + elapsed * perSec);
  bucket.ts = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    throw rateLimited(`Rate limit exceeded (${perSec}/s for this tool and token)`);
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
}

/** Test helper: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
