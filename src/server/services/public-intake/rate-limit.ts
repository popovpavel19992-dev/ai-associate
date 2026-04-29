// src/server/services/public-intake/rate-limit.ts
//
// In-process rate limiter for public intake submissions. Keyed by IP, sliding
// 1-hour window. Acceptable for MVP single-instance deployments. Swap for
// Redis if/when we run more than one server replica.

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 5;
const PURGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface RateLimiter {
  checkAndRecord(ip: string, now?: number): boolean;
  reset(): void;
}

export function createRateLimiter(opts: {
  windowMs?: number;
  max?: number;
} = {}): RateLimiter {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const max = opts.max ?? MAX_PER_WINDOW;
  const buckets = new Map<string, number[]>();
  let lastPurge = 0;

  function purge(now: number) {
    if (now - lastPurge < PURGE_INTERVAL_MS) return;
    lastPurge = now;
    for (const [ip, ts] of buckets.entries()) {
      const fresh = ts.filter((t) => now - t < windowMs);
      if (fresh.length === 0) buckets.delete(ip);
      else buckets.set(ip, fresh);
    }
  }

  return {
    checkAndRecord(ip, now = Date.now()) {
      purge(now);
      const ts = (buckets.get(ip) ?? []).filter((t) => now - t < windowMs);
      if (ts.length >= max) {
        buckets.set(ip, ts);
        return false;
      }
      ts.push(now);
      buckets.set(ip, ts);
      return true;
    },
    reset() {
      buckets.clear();
      lastPurge = 0;
    },
  };
}

export const publicIntakeRateLimiter = createRateLimiter();
