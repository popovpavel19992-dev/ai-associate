// tests/unit/public-intake-rate-limit.test.ts
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/server/services/public-intake/rate-limit";

describe("public-intake rate limit", () => {
  it("allows submissions up to the limit and blocks beyond", () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(rl.checkAndRecord("1.2.3.4")).toBe(true);
    expect(rl.checkAndRecord("1.2.3.4")).toBe(true);
    expect(rl.checkAndRecord("1.2.3.4")).toBe(true);
    expect(rl.checkAndRecord("1.2.3.4")).toBe(false);
  });

  it("scopes per IP — different IPs have independent buckets", () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(rl.checkAndRecord("1.1.1.1")).toBe(true);
    expect(rl.checkAndRecord("1.1.1.1")).toBe(false);
    expect(rl.checkAndRecord("2.2.2.2")).toBe(true);
  });

  it("expires entries after the window", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 2 });
    const t = 10_000;
    expect(rl.checkAndRecord("a", t)).toBe(true);
    expect(rl.checkAndRecord("a", t + 100)).toBe(true);
    expect(rl.checkAndRecord("a", t + 200)).toBe(false);
    // After the window, allowed again.
    expect(rl.checkAndRecord("a", t + 1500)).toBe(true);
  });

  it("default limiter shape — 5 per hour", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(rl.checkAndRecord("z")).toBe(true);
    }
    expect(rl.checkAndRecord("z")).toBe(false);
  });
});
