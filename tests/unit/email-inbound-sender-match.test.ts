// tests/unit/email-inbound-sender-match.test.ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, isSenderMismatch } from "@/server/services/email-outreach/sender-match";

describe("normalizeEmail", () => {
  it("lowercases", () => {
    expect(normalizeEmail("FOO@BAR.COM")).toBe("foo@bar.com");
  });
  it("trims", () => {
    expect(normalizeEmail("  a@b.com  ")).toBe("a@b.com");
  });
  it("strips +tag", () => {
    expect(normalizeEmail("user+tag@example.com")).toBe("user@example.com");
  });
  it("handles already-normalized", () => {
    expect(normalizeEmail("a@b.com")).toBe("a@b.com");
  });
});

describe("isSenderMismatch", () => {
  it("same address → false", () => {
    expect(isSenderMismatch("a@b.com", "A@B.COM")).toBe(false);
  });
  it("+tag vs plain → false", () => {
    expect(isSenderMismatch("a+x@b.com", "a@b.com")).toBe(false);
  });
  it("different user → true", () => {
    expect(isSenderMismatch("a@b.com", "c@b.com")).toBe(true);
  });
  it("different domain → true", () => {
    expect(isSenderMismatch("a@b.com", "a@c.com")).toBe(true);
  });
});
