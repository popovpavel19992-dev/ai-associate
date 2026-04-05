// tests/integration/case-calendar-events-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  caseCalendarEvents,
  calendarEventKindEnum,
  type CaseCalendarEvent,
  type NewCaseCalendarEvent,
} from "@/server/db/schema/case-calendar-events";

describe("case_calendar_events schema", () => {
  it("exports the table object", () => {
    expect(caseCalendarEvents).toBeDefined();
  });

  it("enum has all 5 kinds", () => {
    expect(calendarEventKindEnum.enumValues).toEqual([
      "court_date",
      "filing_deadline",
      "meeting",
      "reminder",
      "other",
    ]);
  });

  it("types are assignable", () => {
    const insert: NewCaseCalendarEvent = {
      caseId: "11111111-1111-1111-1111-111111111111",
      kind: "meeting",
      title: "Test",
      startsAt: new Date(),
      createdBy: "22222222-2222-2222-2222-222222222222",
    };
    expect(insert.kind).toBe("meeting");
    const selectSample = {} as CaseCalendarEvent;
    expect(typeof selectSample).toBe("object");
  });
});
