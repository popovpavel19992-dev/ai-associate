// tests/unit/activity-sessionize.test.ts
//
// Phase 3.9 — pure-function tests for the sessionizer + description helper.

import { describe, it, expect } from "vitest";
import {
  groupIntoSessions,
  describeActivities,
  type ActivityEvent,
} from "@/server/services/activity-tracking/sessionize";

function ev(opts: Partial<ActivityEvent> & {
  id: string;
  startedAt: Date;
  durationSeconds: number;
}): ActivityEvent {
  return {
    id: opts.id,
    userId: opts.userId ?? "user-1",
    caseId: opts.caseId ?? "case-A",
    eventType: opts.eventType ?? "case_view",
    startedAt: opts.startedAt,
    durationSeconds: opts.durationSeconds,
    metadata: opts.metadata ?? {},
  };
}

const T0 = new Date("2026-04-24T09:00:00.000Z");

describe("groupIntoSessions", () => {
  it("returns empty list for no events", () => {
    expect(groupIntoSessions([])).toEqual([]);
  });

  it("collapses a single event with enough duration into one session", () => {
    const sessions = groupIntoSessions([
      ev({ id: "e1", startedAt: T0, durationSeconds: 600 /* 10 min */ }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.totalMinutes).toBe(10);
    expect(sessions[0]!.events).toHaveLength(1);
    expect(sessions[0]!.sourceEventIds).toEqual(["e1"]);
  });

  it("drops sessions shorter than the 6-minute floor", () => {
    const sessions = groupIntoSessions([
      ev({ id: "e1", startedAt: T0, durationSeconds: 60 /* 1 min */ }),
    ]);
    expect(sessions).toHaveLength(0);
  });

  it("merges two events 4 minutes apart on the same case into one session", () => {
    // event1 ends at T0+60s, event2 starts at T0+5min (gap = 4 min) → same session
    const sessions = groupIntoSessions([
      ev({ id: "e1", startedAt: T0, durationSeconds: 60 }),
      ev({
        id: "e2",
        startedAt: new Date(T0.getTime() + 5 * 60 * 1000),
        durationSeconds: 600,
      }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.events).toHaveLength(2);
    expect(sessions[0]!.sourceEventIds).toEqual(["e1", "e2"]);
  });

  it("splits two events 8 minutes apart on the same case into two sessions", () => {
    const sessions = groupIntoSessions([
      ev({ id: "e1", startedAt: T0, durationSeconds: 600 /* 10 min */ }),
      ev({
        id: "e2",
        // event1 ends at T0+10min, event2 starts at T0+18min → 8 min gap
        startedAt: new Date(T0.getTime() + 18 * 60 * 1000),
        durationSeconds: 600,
      }),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.events).toHaveLength(1);
    expect(sessions[1]!.events).toHaveLength(1);
  });

  it("starts a new session when the case differs even if the gap is small", () => {
    const sessions = groupIntoSessions([
      ev({ id: "e1", startedAt: T0, durationSeconds: 600, caseId: "A" }),
      ev({
        id: "e2",
        startedAt: new Date(T0.getTime() + 11 * 60 * 1000),
        durationSeconds: 600,
        caseId: "B",
      }),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.caseId).toBe("A");
    expect(sessions[1]!.caseId).toBe("B");
  });

  it("caps total_minutes at 480 (8h)", () => {
    const sessions = groupIntoSessions([
      ev({ id: "e1", startedAt: T0, durationSeconds: 14400 /* 4h */ }),
      ev({
        id: "e2",
        startedAt: new Date(T0.getTime() + (4 * 60 + 1) * 60 * 1000),
        durationSeconds: 14400,
      }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.totalMinutes).toBeLessThanOrEqual(480);
  });
});

describe("describeActivities", () => {
  it("renders verb-form for a single event", () => {
    const desc = describeActivities([
      ev({ id: "e1", startedAt: T0, durationSeconds: 600, eventType: "motion_draft" }),
    ]);
    expect(desc).toBe("Drafted motion");
  });

  it("aggregates counts across the same event type", () => {
    const desc = describeActivities([
      ev({ id: "e1", startedAt: T0, durationSeconds: 60, eventType: "document_read" }),
      ev({ id: "e2", startedAt: T0, durationSeconds: 60, eventType: "document_read" }),
      ev({ id: "e3", startedAt: T0, durationSeconds: 60, eventType: "document_read" }),
    ]);
    expect(desc).toBe("Reviewed 3 documents");
  });

  it("joins multiple types alphabetically with commas", () => {
    const desc = describeActivities([
      ev({ id: "e1", startedAt: T0, durationSeconds: 60, eventType: "motion_draft" }),
      ev({ id: "e2", startedAt: T0, durationSeconds: 60, eventType: "document_read" }),
      ev({ id: "e3", startedAt: T0, durationSeconds: 60, eventType: "document_read" }),
      ev({ id: "e4", startedAt: T0, durationSeconds: 60, eventType: "email_send" }),
    ]);
    // Alphabetical: "drafted motion", "reviewed 2 documents", "sent email"
    expect(desc.toLowerCase()).toContain("drafted motion");
    expect(desc.toLowerCase()).toContain("reviewed 2 documents");
    expect(desc.toLowerCase()).toContain("sent email");
    // Capitalised first character
    expect(desc.charAt(0)).toBe(desc.charAt(0).toUpperCase());
  });
});
