import { describe, it, expect } from "vitest";
import { generateIcalFeed } from "@/server/lib/ical-generator";

describe("iCal feed generator", () => {
  it("generates valid VCALENDAR with timed events", () => {
    const result = generateIcalFeed([{
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Court Hearing",
      startsAt: new Date("2026-04-22T09:00:00Z"),
      endsAt: new Date("2026-04-22T10:00:00Z"),
      description: "Smith v. Jones",
      location: "District Court",
      kind: "court_date",
      caseId: "abc-123",
    }]);
    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).toContain("PRODID:-//ClearTerms//Calendar//EN");
    expect(result).toContain("SUMMARY:Court Hearing");
    expect(result).toContain("LOCATION:District Court");
    expect(result).toContain("X-PUBLISHED-TTL:PT30M");
    expect(result).toContain("REFRESH-INTERVAL");
  });

  it("generates all-day event", () => {
    const result = generateIcalFeed([{
      id: "550e8400-e29b-41d4-a716-446655440001",
      title: "Filing Deadline",
      startsAt: new Date("2026-04-22T00:00:00Z"),
      endsAt: null,
      kind: "filing_deadline",
      caseId: "abc-123",
    }]);
    expect(result).toContain("SUMMARY:Filing Deadline");
  });

  it("returns empty calendar for no events", () => {
    const result = generateIcalFeed([]);
    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).not.toContain("BEGIN:VEVENT");
  });
});
