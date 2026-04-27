// src/server/db/seed/court-holidays-states.ts
// Phase 3.7 — state court holiday calendars for CA / TX / FL / NY (2026-2027).
// Each state observes all federal holidays plus state-specific dates. Idempotent on
// (jurisdiction, observedDate). Service layer falls back to FEDERAL when a state is
// not represented.

import { db } from "../index";
import { courtHolidays } from "../schema/court-holidays";
import { and, eq } from "drizzle-orm";

type Holiday = { name: string; observedDate: string };

// Federal holidays observed (2026-2027). Mirrors migration 0020 dates.
const FEDERAL_2026_2027: Holiday[] = [
  { name: "New Year's Day", observedDate: "2026-01-01" },
  { name: "Martin Luther King Jr. Day", observedDate: "2026-01-19" },
  { name: "Presidents Day", observedDate: "2026-02-16" },
  { name: "Memorial Day", observedDate: "2026-05-25" },
  { name: "Juneteenth", observedDate: "2026-06-19" },
  { name: "Independence Day", observedDate: "2026-07-03" },
  { name: "Labor Day", observedDate: "2026-09-07" },
  { name: "Columbus Day", observedDate: "2026-10-12" },
  { name: "Veterans Day", observedDate: "2026-11-11" },
  { name: "Thanksgiving Day", observedDate: "2026-11-26" },
  { name: "Christmas Day", observedDate: "2026-12-25" },
  { name: "New Year's Day", observedDate: "2027-01-01" },
  { name: "Martin Luther King Jr. Day", observedDate: "2027-01-18" },
  { name: "Presidents Day", observedDate: "2027-02-15" },
  { name: "Memorial Day", observedDate: "2027-05-31" },
  { name: "Juneteenth", observedDate: "2027-06-18" },
  { name: "Independence Day", observedDate: "2027-07-05" },
  { name: "Labor Day", observedDate: "2027-09-06" },
  { name: "Columbus Day", observedDate: "2027-10-11" },
  { name: "Veterans Day", observedDate: "2027-11-11" },
  { name: "Thanksgiving Day", observedDate: "2027-11-25" },
  { name: "Christmas Day", observedDate: "2027-12-24" },
];

// State-specific observed holidays (in addition to federal).
const CA_EXTRA: Holiday[] = [
  { name: "Cesar Chavez Day", observedDate: "2026-03-31" },
  { name: "Cesar Chavez Day", observedDate: "2027-03-31" },
];

const TX_EXTRA: Holiday[] = [
  { name: "Texas Independence Day", observedDate: "2026-03-02" },
  { name: "San Jacinto Day", observedDate: "2026-04-21" },
  { name: "Emancipation Day in Texas", observedDate: "2026-06-19" }, // overlaps with Juneteenth
  { name: "Lyndon Baines Johnson Day", observedDate: "2026-08-27" },
  { name: "Texas Independence Day", observedDate: "2027-03-02" },
  { name: "San Jacinto Day", observedDate: "2027-04-21" },
];

// FL: Confederate Memorial Day removed in many county courts post-2020; we omit it.
// State observes federal holidays plus a few extras for state-government office closure.
const FL_EXTRA: Holiday[] = [
  { name: "Friday after Thanksgiving", observedDate: "2026-11-27" },
  { name: "Friday after Thanksgiving", observedDate: "2027-11-26" },
];

const NY_EXTRA: Holiday[] = [
  // Election Day — NY CPLR 2(f); Tuesday after first Monday in November.
  { name: "Election Day", observedDate: "2026-11-03" },
  { name: "Election Day", observedDate: "2027-11-02" },
  // NY courts close on Lincoln's Birthday (Feb 12) and observe Election Day.
  { name: "Lincoln's Birthday", observedDate: "2026-02-12" },
  { name: "Lincoln's Birthday", observedDate: "2027-02-12" },
  { name: "Friday after Thanksgiving", observedDate: "2026-11-27" },
  { name: "Friday after Thanksgiving", observedDate: "2027-11-26" },
];

const STATE_CALENDARS: Array<{ jurisdiction: "CA" | "TX" | "FL" | "NY"; holidays: Holiday[] }> = [
  { jurisdiction: "CA", holidays: [...FEDERAL_2026_2027, ...CA_EXTRA] },
  { jurisdiction: "TX", holidays: [...FEDERAL_2026_2027, ...TX_EXTRA] },
  { jurisdiction: "FL", holidays: [...FEDERAL_2026_2027, ...FL_EXTRA] },
  { jurisdiction: "NY", holidays: [...FEDERAL_2026_2027, ...NY_EXTRA] },
];

export async function seedStateCourtHolidays(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const { jurisdiction, holidays } of STATE_CALENDARS) {
    for (const h of holidays) {
      const existing = await db
        .select({ id: courtHolidays.id })
        .from(courtHolidays)
        .where(
          and(
            eq(courtHolidays.jurisdiction, jurisdiction),
            eq(courtHolidays.observedDate, h.observedDate),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(courtHolidays).values({
        jurisdiction,
        name: h.name,
        observedDate: h.observedDate,
      });
      inserted++;
    }
  }

  return { inserted, skipped };
}

export const STATE_HOLIDAY_COUNTS = {
  CA: FEDERAL_2026_2027.length + CA_EXTRA.length,
  TX: FEDERAL_2026_2027.length + TX_EXTRA.length,
  FL: FEDERAL_2026_2027.length + FL_EXTRA.length,
  NY: FEDERAL_2026_2027.length + NY_EXTRA.length,
} as const;
