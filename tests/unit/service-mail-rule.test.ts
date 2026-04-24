import { describe, it, expect } from "vitest";

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mailRuleApplied(shiftedReason: string | null): boolean {
  return (shiftedReason ?? "").includes("FRCP 6(d) mail rule");
}

function appendMailReason(existing: string | null): string {
  const prefix = existing && existing.length > 0 ? `${existing}; ` : "";
  return `${prefix}FRCP 6(d) mail rule`;
}

describe("FRCP 6(d) mail rule helpers", () => {
  it("adds 3 calendar days mid-month", () => {
    expect(addCalendarDays("2026-05-10", 3)).toBe("2026-05-13");
  });

  it("rolls over month boundary", () => {
    expect(addCalendarDays("2026-05-30", 3)).toBe("2026-06-02");
  });

  it("rolls over year boundary", () => {
    expect(addCalendarDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("detects prior mail-rule shifted_reason", () => {
    expect(mailRuleApplied("weekend; FRCP 6(d) mail rule")).toBe(true);
    expect(mailRuleApplied("weekend")).toBe(false);
    expect(mailRuleApplied(null)).toBe(false);
  });

  it("appendMailReason preserves existing reasons", () => {
    expect(appendMailReason(null)).toBe("FRCP 6(d) mail rule");
    expect(appendMailReason("weekend")).toBe("weekend; FRCP 6(d) mail rule");
  });
});
