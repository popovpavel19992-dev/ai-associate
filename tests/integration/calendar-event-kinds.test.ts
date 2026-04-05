// tests/integration/calendar-event-kinds.test.ts
import { describe, it, expect } from "vitest";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_META,
  DEADLINE_KINDS,
  type CalendarEventKind,
} from "@/lib/calendar-events";

describe("calendar event kinds", () => {
  it("has exactly 5 kinds in the expected order", () => {
    expect(CALENDAR_EVENT_KINDS).toEqual([
      "court_date",
      "filing_deadline",
      "meeting",
      "reminder",
      "other",
    ]);
  });

  it("every kind has label, colorClass, icon", () => {
    for (const kind of CALENDAR_EVENT_KINDS) {
      const meta = CALENDAR_EVENT_KIND_META[kind];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.colorClass).toMatch(/bg-\w/);
      expect(meta.colorClass).toMatch(/text-\w/);
      expect(meta.colorClass).toMatch(/border-\w/);
      expect(typeof meta.icon).toBe("object");
    }
  });

  it("DEADLINE_KINDS contains exactly court_date and filing_deadline", () => {
    expect(DEADLINE_KINDS.size).toBe(2);
    expect(DEADLINE_KINDS.has("court_date")).toBe(true);
    expect(DEADLINE_KINDS.has("filing_deadline")).toBe(true);
  });

  it("CalendarEventKind type is constrained to the tuple", () => {
    const sample: CalendarEventKind = "meeting";
    expect(CALENDAR_EVENT_KINDS).toContain(sample);
  });
});
