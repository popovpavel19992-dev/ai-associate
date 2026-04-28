// tests/unit/activity-suggestions.test.ts
//
// Phase 3.9 — Tests for the suggestions service. Uses a hand-rolled
// drizzle mock that returns canned rows per .from()/.insert() call so
// we can verify the dedupe + accept/dismiss flows without a live DB.

import { describe, it, expect } from "vitest";
import {
  refreshSuggestions,
  acceptSuggestion,
  dismissSuggestion,
} from "@/server/services/activity-tracking/suggestions-service";

type Op = { kind: "insert" | "update"; table: string; values?: any; set?: any };

function makeDb(opts: {
  selectQueue: any[][];
  insertReturns?: any[][];
  insertReturnId?: string;
}) {
  const queue = [...opts.selectQueue];
  const insertReturns = [...(opts.insertReturns ?? [])];
  const ops: Op[] = [];

  const db: any = {
    select: (_cols?: any) => ({
      from: (table: any) => {
        const rows = queue.shift() ?? [];
        const chain: any = {
          where: (_w: any) => chain,
          innerJoin: (_t: any, _on: any) => chain,
          leftJoin: (_t: any, _on: any) => chain,
          orderBy: (..._x: any[]) => chain,
          limit: (_n: number) => chain,
          offset: (_n: number) => chain,
          returning: (_x?: any) => Promise.resolve(rows),
          then: (resolve: any, reject: any) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", table: tableName(table), values: v });
        const ret = insertReturns.shift();
        const chain: any = {
          onConflictDoNothing: (_o?: any) => chain,
          returning: (_cols?: any) =>
            Promise.resolve(
              ret ?? [{ id: opts.insertReturnId ?? "row-1" }],
            ),
          then: (resolve: any, reject: any) =>
            Promise.resolve(ret ?? [{ id: opts.insertReturnId ?? "row-1" }]).then(
              resolve,
              reject,
            ),
        };
        return chain;
      },
    }),
    update: (table: any) => ({
      set: (s: any) => ({
        where: (_w: any) => {
          ops.push({ kind: "update", table: tableName(table), set: s });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, ops };
}

function tableName(t: any): string {
  // Drizzle tables expose Symbol(drizzle:Name); fall back to inferred string.
  if (!t) return "?";
  const sym = Object.getOwnPropertySymbols(t).find((s) =>
    s.toString().includes("OriginalName") || s.toString().includes("Name"),
  );
  if (sym) return String((t as any)[sym]);
  return String(t.name ?? "?");
}

const T0 = new Date("2026-04-24T09:00:00.000Z");

describe("refreshSuggestions", () => {
  it("inserts a new pending suggestion when activity warrants one", async () => {
    const { db, ops } = makeDb({
      selectQueue: [
        // 1. user lookup → orgId
        [{ orgId: "org-1" }],
        // 2. case_activity_events fetch (sessionize)
        [
          {
            id: "e1",
            userId: "user-1",
            caseId: "case-A",
            eventType: "motion_draft",
            startedAt: T0,
            durationSeconds: 600, // 10 min, ≥6 min floor
            metadata: {},
          },
        ],
        // 3. existing suggestions dedupe lookup → none
        [],
      ],
      insertReturns: [[{ id: "sug-1" }]],
    });

    const r = await refreshSuggestions(db, "user-1", 7);
    expect(r.created).toBe(1);

    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(1);
    const v = inserts[0]!.values;
    const row = Array.isArray(v) ? v[0] : v;
    expect(row.userId).toBe("user-1");
    expect(row.caseId).toBe("case-A");
    expect(row.totalMinutes).toBe(10);
    expect(row.status).toBe("pending");
    expect(row.suggestedDescription.toLowerCase()).toContain("drafted motion");
  });

  it("skips insertion when an existing suggestion already covers the session", async () => {
    const { db, ops } = makeDb({
      selectQueue: [
        // user lookup
        [{ orgId: "org-1" }],
        // events
        [
          {
            id: "e1",
            userId: "user-1",
            caseId: "case-A",
            eventType: "case_view",
            startedAt: T0,
            durationSeconds: 600,
            metadata: {},
          },
        ],
        // existing dedupe lookup — returns a hit at the same startedAt
        [{ sessionStartedAt: T0 }],
      ],
    });

    const r = await refreshSuggestions(db, "user-1", 7);
    expect(r.created).toBe(0);
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("returns zero when user has no activity events", async () => {
    const { db } = makeDb({
      selectQueue: [
        [{ orgId: "org-1" }], // user
        [], // events empty
      ],
    });
    const r = await refreshSuggestions(db, "user-1", 7);
    expect(r.created).toBe(0);
  });
});

describe("acceptSuggestion", () => {
  it("creates a real time_entries row and marks the suggestion accepted", async () => {
    const { db, ops } = makeDb({
      selectQueue: [
        // 1. suggestion lookup
        [
          {
            id: "sug-1",
            orgId: "org-1",
            userId: "user-1",
            caseId: "case-A",
            sessionStartedAt: T0,
            sessionEndedAt: new Date(T0.getTime() + 10 * 60 * 1000),
            totalMinutes: 10,
            suggestedDescription: "Drafted motion",
            sourceEventIds: ["e1"],
            status: "pending",
          },
        ],
        // 2. case-specific billing rate lookup → none
        [],
        // 3. default billing rate → 250/hr
        [{ rateCents: 25000 }],
      ],
      insertReturns: [[{ id: "te-1" }]],
    });

    const r = await acceptSuggestion(db, "sug-1");
    expect(r.timeEntryId).toBe("te-1");

    // One insert into time_entries, then one update on the suggestion.
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(1);
    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set.status).toBe("accepted");
    expect(updates[0]!.set.acceptedTimeEntryId).toBe("te-1");
  });

  it("marks edited_accepted when the user overrides description", async () => {
    const { db, ops } = makeDb({
      selectQueue: [
        [
          {
            id: "sug-1",
            orgId: "org-1",
            userId: "user-1",
            caseId: "case-A",
            sessionStartedAt: T0,
            sessionEndedAt: new Date(T0.getTime() + 10 * 60 * 1000),
            totalMinutes: 10,
            suggestedDescription: "Drafted motion",
            sourceEventIds: ["e1"],
            status: "pending",
          },
        ],
        [],
        [{ rateCents: 25000 }],
      ],
      insertReturns: [[{ id: "te-2" }]],
    });

    await acceptSuggestion(db, "sug-1", { description: "Custom note" });
    const updates = ops.filter((o) => o.kind === "update");
    expect(updates[0]!.set.status).toBe("edited_accepted");
  });
});

describe("dismissSuggestion", () => {
  it("issues an UPDATE setting status=dismissed without inserting a time entry", async () => {
    const { db, ops } = makeDb({ selectQueue: [] });
    await dismissSuggestion(db, "sug-1");
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set.status).toBe("dismissed");
  });
});
