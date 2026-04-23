// tests/unit/deadlines-compute.test.ts
import { describe, it, expect } from "vitest";
import {
  isBusinessDay,
  addBusinessDays,
  computeDeadlineDate,
} from "@/server/services/deadlines/compute";

const HOLIDAYS = new Set<string>([
  "2026-07-03",
  "2026-11-26",
  "2026-12-25",
]);

describe("isBusinessDay", () => {
  it("Monday-Friday non-holiday is business day", () => {
    expect(isBusinessDay(new Date("2026-05-04"), HOLIDAYS)).toBe(true);
  });
  it("Saturday is not business day", () => {
    expect(isBusinessDay(new Date("2026-05-02"), HOLIDAYS)).toBe(false);
  });
  it("Sunday is not business day", () => {
    expect(isBusinessDay(new Date("2026-05-03"), HOLIDAYS)).toBe(false);
  });
  it("Holiday is not business day", () => {
    expect(isBusinessDay(new Date("2026-11-26"), HOLIDAYS)).toBe(false);
  });
});

describe("addBusinessDays", () => {
  it("adding 1 business day from Monday lands Tuesday", () => {
    const result = addBusinessDays(new Date("2026-05-04"), 1, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-05");
  });
  it("adding 1 business day from Friday skips weekend to Monday", () => {
    const result = addBusinessDays(new Date("2026-05-01"), 1, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-04");
  });
  it("adding 5 business days over a weekend and holiday", () => {
    const result = addBusinessDays(new Date("2026-11-24"), 5, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-12-02");
  });
  it("adding 0 days returns the same day (if business day)", () => {
    const result = addBusinessDays(new Date("2026-05-04"), 0, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-04");
  });
  it("subtracting business days (negative) works", () => {
    const result = addBusinessDays(new Date("2026-05-06"), -3, HOLIDAYS);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-01");
  });
});

describe("computeDeadlineDate", () => {
  it("calendar days + plain weekday result: no shift", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),
      days: 2,
      dayType: "calendar",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-06");
    expect(r.shiftedReason).toBeNull();
  });

  it("calendar days landing on Sunday shifts to Monday", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),
      days: 6,
      dayType: "calendar",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-11");
    expect(r.raw.toISOString().slice(0, 10)).toBe("2026-05-10");
    expect(r.shiftedReason).toBe("weekend");
  });

  it("calendar days landing on holiday shifts to next business day", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-11-25"),
      days: 1,
      dayType: "calendar",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(r.shiftedReason).toContain("holiday");
  });

  it("shiftIfHoliday=false keeps raw date even on weekend", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),
      days: 6,
      dayType: "calendar",
      shiftIfHoliday: false,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-10");
    expect(r.shiftedReason).toBeNull();
  });

  it("court days skip weekends inherently", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-04"),
      days: 3,
      dayType: "court",
      shiftIfHoliday: true,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-07");
  });

  it("negative days walk backwards (pretrial deadlines)", () => {
    const r = computeDeadlineDate({
      triggerDate: new Date("2026-05-11"),
      days: -7,
      dayType: "calendar",
      shiftIfHoliday: false,
      holidays: HOLIDAYS,
    });
    expect(r.dueDate.toISOString().slice(0, 10)).toBe("2026-05-04");
  });
});
