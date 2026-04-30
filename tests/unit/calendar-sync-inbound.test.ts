// tests/unit/calendar-sync-inbound.test.ts
//
// Phase 3.19 — Two-way calendar sync. Covers:
//   - The pure overlap arithmetic in computeOverlap()
//   - New schema imports (3.19 inbound tables) parse without error
//
// Provider-level tests (Google syncToken / Outlook deltaLink) are easier to
// add when we wire integration tests against a mock Google + Graph server;
// not in scope for this unit suite.

import { describe, it, expect } from "vitest";
import { computeOverlap } from "@/server/services/calendar-sync/inbound";

const D = (iso: string) => new Date(iso);

describe("computeOverlap", () => {
  it("returns null when the events are fully disjoint", () => {
    expect(
      computeOverlap(
        { startsAt: D("2026-05-01T10:00Z"), endsAt: D("2026-05-01T11:00Z") },
        { startsAt: D("2026-05-01T12:00Z"), endsAt: D("2026-05-01T13:00Z") },
      ),
    ).toBeNull();
  });

  it("returns null when events touch but do not overlap", () => {
    expect(
      computeOverlap(
        { startsAt: D("2026-05-01T10:00Z"), endsAt: D("2026-05-01T11:00Z") },
        { startsAt: D("2026-05-01T11:00Z"), endsAt: D("2026-05-01T12:00Z") },
      ),
    ).toBeNull();
  });

  it("returns the intersection for a partial overlap", () => {
    const out = computeOverlap(
      { startsAt: D("2026-05-01T10:00Z"), endsAt: D("2026-05-01T12:00Z") },
      { startsAt: D("2026-05-01T11:00Z"), endsAt: D("2026-05-01T13:00Z") },
    );
    expect(out?.startsAt.toISOString()).toBe("2026-05-01T11:00:00.000Z");
    expect(out?.endsAt.toISOString()).toBe("2026-05-01T12:00:00.000Z");
  });

  it("returns the inner range when one event fully contains the other", () => {
    const out = computeOverlap(
      { startsAt: D("2026-05-01T09:00Z"), endsAt: D("2026-05-01T17:00Z") },
      { startsAt: D("2026-05-01T13:00Z"), endsAt: D("2026-05-01T14:00Z") },
    );
    expect(out?.startsAt.toISOString()).toBe("2026-05-01T13:00:00.000Z");
    expect(out?.endsAt.toISOString()).toBe("2026-05-01T14:00:00.000Z");
  });

  it("treats open-ended events as 30-minute windows", () => {
    // a starts at 10:00 with no end → defaults to 10:30
    // b is 10:15 → 11:00 — should overlap 10:15..10:30
    const out = computeOverlap(
      { startsAt: D("2026-05-01T10:00Z"), endsAt: null },
      { startsAt: D("2026-05-01T10:15Z"), endsAt: D("2026-05-01T11:00Z") },
    );
    expect(out?.startsAt.toISOString()).toBe("2026-05-01T10:15:00.000Z");
    expect(out?.endsAt.toISOString()).toBe("2026-05-01T10:30:00.000Z");
  });

  it("two open-ended events at the same start fully overlap (30 min)", () => {
    const out = computeOverlap(
      { startsAt: D("2026-05-01T10:00Z"), endsAt: null },
      { startsAt: D("2026-05-01T10:00Z"), endsAt: null },
    );
    expect(out?.startsAt.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(out?.endsAt.toISOString()).toBe("2026-05-01T10:30:00.000Z");
  });

  it("is symmetric", () => {
    const a = { startsAt: D("2026-05-01T10:00Z"), endsAt: D("2026-05-01T12:00Z") };
    const b = { startsAt: D("2026-05-01T11:00Z"), endsAt: D("2026-05-01T13:00Z") };
    const ab = computeOverlap(a, b);
    const ba = computeOverlap(b, a);
    expect(ab?.startsAt.toISOString()).toBe(ba?.startsAt.toISOString());
    expect(ab?.endsAt.toISOString()).toBe(ba?.endsAt.toISOString());
  });
});

describe("3.19 schema imports", () => {
  it("imports external_inbound_events", async () => {
    const mod = await import(
      "@/server/db/schema/external-inbound-events"
    );
    expect(mod.externalInboundEvents).toBeDefined();
  });

  it("imports inbound_event_conflicts + resolution enum", async () => {
    const mod = await import(
      "@/server/db/schema/inbound-event-conflicts"
    );
    expect(mod.inboundEventConflicts).toBeDefined();
    expect(mod.conflictResolutionEnum).toBeDefined();
    expect(mod.conflictResolutionEnum.enumValues).toEqual([
      "open",
      "dismissed",
      "rescheduled",
    ]);
  });

  it("calendar-connections has inbound sync fields", async () => {
    const mod = await import("@/server/db/schema/calendar-connections");
    const cols = mod.calendarConnections;
    // Drizzle table objects expose columns as properties
    expect((cols as unknown as Record<string, unknown>).syncToken).toBeDefined();
    expect((cols as unknown as Record<string, unknown>).deltaLink).toBeDefined();
    expect(
      (cols as unknown as Record<string, unknown>).inboundSyncEnabled,
    ).toBeDefined();
    expect(
      (cols as unknown as Record<string, unknown>).lastInboundSyncAt,
    ).toBeDefined();
  });
});
