import { describe, it, expect } from "vitest";
import { mapToGoogleEvent } from "@/server/lib/calendar-providers/google";

describe("GoogleCalendarProvider mapping", () => {
  it("maps timed event to Google format", () => {
    const result = mapToGoogleEvent({
      title: "Court Hearing",
      description: "Smith v. Jones",
      startsAt: new Date("2026-04-22T09:00:00Z"),
      endsAt: new Date("2026-04-22T10:00:00Z"),
      location: "District Court, Room 4B",
    }, "https://app.clearterms.com/cases/abc");

    expect(result.summary).toBe("Court Hearing");
    expect((result.start as any).dateTime).toBe("2026-04-22T09:00:00.000Z");
    expect((result.end as any).dateTime).toBe("2026-04-22T10:00:00.000Z");
    expect(result.location).toBe("District Court, Room 4B");
    expect(result.description).toContain("Smith v. Jones");
    expect(result.description).toContain("Managed by ClearTerms");
    expect(result.description).toContain("https://app.clearterms.com/cases/abc");
  });

  it("maps all-day event (endsAt null) to Google date format", () => {
    const result = mapToGoogleEvent({
      title: "Filing Deadline",
      startsAt: new Date("2026-04-22T00:00:00Z"),
    }, "https://app.clearterms.com/cases/abc");

    expect((result.start as any).date).toBe("2026-04-22");
    expect((result.end as any).date).toBe("2026-04-23");
    expect((result.start as any).dateTime).toBeUndefined();
  });
});
