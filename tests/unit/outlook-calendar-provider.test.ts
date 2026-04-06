import { describe, it, expect } from "vitest";
import { mapToOutlookEvent } from "@/server/lib/calendar-providers/outlook";

describe("OutlookCalendarProvider mapping", () => {
  it("maps timed event to Outlook/Graph format", () => {
    const result = mapToOutlookEvent({
      title: "Client Meeting",
      description: "Discuss settlement",
      startsAt: new Date("2026-04-22T14:00:00Z"),
      endsAt: new Date("2026-04-22T15:00:00Z"),
      location: "Office",
    }, "https://app.clearterms.com/cases/xyz");

    expect(result.subject).toBe("Client Meeting");
    expect(result.start?.dateTime).toBe("2026-04-22T14:00:00.000Z");
    expect(result.start?.timeZone).toBe("UTC");
    expect(result.end?.dateTime).toBe("2026-04-22T15:00:00.000Z");
    expect(result.location?.displayName).toBe("Office");
    expect(result.body?.content).toContain("Discuss settlement");
    expect(result.body?.content).toContain("Managed by ClearTerms");
    expect(result.isAllDay).toBe(false);
  });

  it("maps all-day event to Outlook format", () => {
    const result = mapToOutlookEvent({
      title: "Filing Deadline",
      startsAt: new Date("2026-04-22T00:00:00Z"),
    }, "https://app.clearterms.com/cases/xyz");

    expect(result.isAllDay).toBe(true);
    expect(result.start?.dateTime).toBe("2026-04-22T00:00:00.000Z");
  });
});
