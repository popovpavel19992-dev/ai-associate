// tests/unit/court-holidays-states.test.ts
// Phase 3.7 — verifies state holiday calendar shape.

import { describe, it, expect } from "vitest";
import { STATE_HOLIDAY_COUNTS } from "@/server/db/seed/court-holidays-states";
import fs from "node:fs";
import path from "node:path";

describe("state court holiday seed coverage", () => {
  it("each state has at least 22 holidays seeded (federal + extras for 2026-2027)", () => {
    expect(STATE_HOLIDAY_COUNTS.CA).toBeGreaterThanOrEqual(22);
    expect(STATE_HOLIDAY_COUNTS.TX).toBeGreaterThanOrEqual(22);
    expect(STATE_HOLIDAY_COUNTS.FL).toBeGreaterThanOrEqual(22);
    expect(STATE_HOLIDAY_COUNTS.NY).toBeGreaterThanOrEqual(22);
  });

  const seedFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/server/db/seed/court-holidays-states.ts"),
    "utf8",
  );

  it("CA includes Cesar Chavez Day", () => {
    expect(seedFile).toMatch(/Cesar Chavez Day/);
    const caBlock = seedFile.match(/CA_EXTRA[\s\S]*?const TX_EXTRA/)?.[0] ?? "";
    expect(caBlock).toMatch(/2026-03-31/);
  });

  it("TX includes Texas Independence Day + San Jacinto Day", () => {
    const txBlock = seedFile.match(/TX_EXTRA[\s\S]*?const FL_EXTRA/)?.[0] ?? "";
    expect(txBlock).toMatch(/Texas Independence Day/);
    expect(txBlock).toMatch(/San Jacinto Day/);
  });

  it("NY includes Election Day for 2026 (Tue after first Mon Nov)", () => {
    const nyBlock = seedFile.match(/NY_EXTRA[\s\S]*?const STATE_CALENDARS/)?.[0] ?? "";
    expect(nyBlock).toMatch(/Election Day[\s\S]*?2026-11-03/);
  });

  it("each state seeds the federal calendar (Independence Day 2026)", () => {
    expect(seedFile).toMatch(/2026-07-03/);
    expect(seedFile).toMatch(/2027-07-05/);
  });
});
