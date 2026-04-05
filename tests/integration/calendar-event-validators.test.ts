// tests/integration/calendar-event-validators.test.ts
import { describe, it, expect } from "vitest";
import {
  calendarEventCreateSchema,
  calendarEventUpdateSchema,
  CALENDAR_EVENT_KINDS,
} from "@/lib/calendar-events";

const baseInput = {
  caseId: "550e8400-e29b-41d4-a716-446655440000",
  kind: "meeting" as const,
  title: "Client call",
  startsAt: new Date("2026-05-01T10:00:00Z"),
};

describe("calendarEventCreateSchema", () => {
  it("accepts minimum valid input", () => {
    expect(calendarEventCreateSchema.safeParse(baseInput).success).toBe(true);
  });

  it("rejects empty title", () => {
    const r = calendarEventCreateSchema.safeParse({ ...baseInput, title: "" });
    expect(r.success).toBe(false);
  });

  it("rejects title longer than 200 chars", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      title: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("rejects location longer than 300 chars", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      location: "x".repeat(301),
    });
    expect(r.success).toBe(false);
  });

  it("accepts null endsAt (all-day/moment)", () => {
    const r = calendarEventCreateSchema.safeParse({ ...baseInput, endsAt: null });
    expect(r.success).toBe(true);
  });

  it("rejects endsAt <= startsAt", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      endsAt: new Date("2026-05-01T10:00:00Z"),
    });
    expect(r.success).toBe(false);
  });

  it("accepts endsAt > startsAt", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      endsAt: new Date("2026-05-01T11:00:00Z"),
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid caseId uuid", () => {
    const r = calendarEventCreateSchema.safeParse({
      ...baseInput,
      caseId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("accepts all 5 kinds", () => {
    for (const kind of CALENDAR_EVENT_KINDS) {
      expect(
        calendarEventCreateSchema.safeParse({ ...baseInput, kind }).success,
      ).toBe(true);
    }
  });
});

describe("calendarEventUpdateSchema", () => {
  it("requires id", () => {
    const r = calendarEventUpdateSchema.safeParse({ title: "x" } as unknown);
    expect(r.success).toBe(false);
  });

  it("accepts id-only patch", () => {
    const r = calendarEventUpdateSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });

  it("rejects endsAt <= startsAt on patch when both present", () => {
    const r = calendarEventUpdateSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      startsAt: new Date("2026-05-01T10:00:00Z"),
      endsAt: new Date("2026-05-01T09:00:00Z"),
    });
    expect(r.success).toBe(false);
  });
});
