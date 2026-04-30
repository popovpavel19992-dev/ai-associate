// tests/unit/discovery-deadline-checker.test.ts

import { describe, it, expect } from "vitest";
import {
  RESPONSE_DEADLINE_DAYS,
  deadlineFor,
  daysUntilDeadline,
  markRequestOverdue,
} from "@/server/services/discovery-responses/deadline-checker";

describe("deadline-checker pure helpers", () => {
  it("RESPONSE_DEADLINE_DAYS = 30", () => {
    expect(RESPONSE_DEADLINE_DAYS).toBe(30);
  });

  it("deadlineFor adds 30 calendar days", () => {
    const served = new Date("2026-04-01T00:00:00Z");
    const due = deadlineFor(served);
    expect(due.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("daysUntilDeadline returns positive when before due, negative when past", () => {
    const served = new Date("2026-04-01T00:00:00Z");
    expect(daysUntilDeadline(served, new Date("2026-04-10T00:00:00Z"))).toBeGreaterThan(0);
    expect(daysUntilDeadline(served, new Date("2026-05-15T00:00:00Z"))).toBeLessThan(0);
  });
});

describe("markRequestOverdue", () => {
  it("issues an update with status='overdue'", async () => {
    const updates: any[] = [];
    const db: any = {
      update: () => ({
        set: (s: any) => ({
          where: () => {
            updates.push(s);
            return Promise.resolve();
          },
        }),
      }),
    };
    await markRequestOverdue(db, "r1");
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("overdue");
  });
});
