import { describe, it, expect } from "vitest";
import {
  buildIcs,
  escapeText,
  foldLine,
  formatDateUtc,
  formatDateOnly,
} from "@/server/services/calendar-export/ical-builder";

describe("calendar-export ical-builder", () => {
  const NOW = new Date("2026-04-24T12:00:00Z");

  it("renders a minimal single-event calendar with required fields", () => {
    const ics = buildIcs(
      [
        {
          uid: "deadline-1@clearterms",
          dtStart: new Date("2026-05-01T15:00:00Z"),
          dtEnd: new Date("2026-05-01T16:00:00Z"),
          summary: "Hearing",
        },
      ],
      { now: NOW, calendarName: "Fedor's ClearTerms" },
    );

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//ClearTerms//Calendar Export//EN\r\n");
    expect(ics).toContain("CALSCALE:GREGORIAN\r\n");
    expect(ics).toContain("X-WR-CALNAME:Fedor's ClearTerms\r\n");
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("UID:deadline-1@clearterms\r\n");
    expect(ics).toContain("DTSTAMP:20260424T120000Z\r\n");
    expect(ics).toContain("DTSTART:20260501T150000Z\r\n");
    expect(ics).toContain("DTEND:20260501T160000Z\r\n");
    expect(ics).toContain("SUMMARY:Hearing\r\n");
    expect(ics).toContain("END:VEVENT\r\n");
  });

  it("renders all-day events with DTSTART;VALUE=DATE and no DTEND", () => {
    const ics = buildIcs(
      [
        {
          uid: "filing-1@clearterms",
          dtStart: new Date("2026-06-15T00:00:00Z"),
          allDay: true,
          summary: "[Acme v. Widget] Answer to Complaint due",
        },
      ],
      { now: NOW },
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260615\r\n");
    expect(ics).not.toContain("DTEND:");
  });

  it("escapes special characters in SUMMARY/DESCRIPTION/LOCATION", () => {
    expect(escapeText("hello, world; line1\nline2\\path")).toBe(
      "hello\\, world\\; line1\\nline2\\\\path",
    );

    const ics = buildIcs(
      [
        {
          uid: "evt-2@clearterms",
          dtStart: new Date("2026-05-01T15:00:00Z"),
          dtEnd: new Date("2026-05-01T16:00:00Z"),
          summary: "Smith, John v. Doe; Co.",
          description: "Line one\nLine two",
          location: "123 Main St, Suite 5; NYC",
        },
      ],
      { now: NOW },
    );
    expect(ics).toContain("SUMMARY:Smith\\, John v. Doe\\; Co.\r\n");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\r\n");
    expect(ics).toContain("LOCATION:123 Main St\\, Suite 5\\; NYC\r\n");
  });

  it("folds lines longer than 75 octets per RFC 5545", () => {
    const long = "X".repeat(200);
    const folded = foldLine(`SUMMARY:${long}`);
    expect(folded.includes("\r\n ")).toBe(true);
    // Each non-final segment is exactly 75 octets (or 74 + leading space) before the fold.
    const segments = folded.split("\r\n ");
    expect(segments.length).toBeGreaterThan(1);
    // Reconstruct: dropping the leading-space continuation must yield the original.
    expect(segments.join("")).toBe(`SUMMARY:${long}`);
  });

  it("does not fold lines under 75 octets", () => {
    const short = "SUMMARY:Hello";
    expect(foldLine(short)).toBe(short);
  });

  it("formats dates correctly", () => {
    expect(formatDateUtc(new Date("2026-04-24T12:34:56Z"))).toBe(
      "20260424T123456Z",
    );
    expect(formatDateOnly(new Date("2026-04-24T12:34:56Z"))).toBe("20260424");
  });

  it("emits URL property when provided", () => {
    const ics = buildIcs(
      [
        {
          uid: "evt-url@clearterms",
          dtStart: new Date("2026-05-01T15:00:00Z"),
          dtEnd: new Date("2026-05-01T16:00:00Z"),
          summary: "Mediation",
          url: "https://app.clearterms.com/cases/abc-123",
        },
      ],
      { now: NOW },
    );
    expect(ics).toContain("URL:https://app.clearterms.com/cases/abc-123\r\n");
  });

  it("renders multiple events", () => {
    const ics = buildIcs(
      [
        {
          uid: "a@clearterms",
          dtStart: new Date("2026-05-01T15:00:00Z"),
          allDay: true,
          summary: "A",
        },
        {
          uid: "b@clearterms",
          dtStart: new Date("2026-05-02T15:00:00Z"),
          dtEnd: new Date("2026-05-02T16:00:00Z"),
          summary: "B",
        },
      ],
      { now: NOW },
    );
    const beginCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    expect(beginCount).toBe(2);
    expect(ics).toContain("UID:a@clearterms");
    expect(ics).toContain("UID:b@clearterms");
  });
});
