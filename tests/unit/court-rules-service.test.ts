// tests/unit/court-rules-service.test.ts
//
// Unit tests for the court-rules service. Uses a hand-rolled mock db that
// records each query's terminal resolution to allow flexible chains
// (select → from → innerJoin → where → orderBy → limit → offset).

import { describe, it, expect } from "vitest";
import {
  searchRules,
  getRule,
  addBookmark,
  removeBookmark,
  listBookmarks,
  listJurisdictions,
} from "@/server/services/court-rules/service";

type Op = { kind: string; values?: any; set?: any; conflict?: boolean };

function makeMockDb(opts: { selectRows?: any[][]; insertReturnId?: string } = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];

  // A chainable terminal that resolves to the next queued select-row batch.
  function makeChain(): any {
    const next = () => (selectQueue.length > 0 ? selectQueue.shift()! : []);
    let resolved: any[] | null = null;
    const chain: any = {
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: (_n: number) => chain,
      offset: (_n: number) => chain,
      then: (resolve: any, reject: any) => {
        if (resolved == null) resolved = next();
        return Promise.resolve(resolved).then(resolve, reject);
      },
    };
    return chain;
  }

  const db: any = {
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        const builder: any = {
          returning: async () => [{ id: opts.insertReturnId ?? "row-1" }],
          onConflictDoUpdate: (_args: any) => {
            ops.push({ kind: "insert-on-conflict", values: v, conflict: true });
            return {
              returning: async () => [{ id: opts.insertReturnId ?? "row-1" }],
            };
          },
        };
        return builder;
      },
    }),
    update: (_t: any) => ({
      set: (s: any) => ({
        where: () => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
    delete: (_t: any) => ({
      where: () => {
        ops.push({ kind: "delete" });
        return Promise.resolve();
      },
    }),
    select: (_cols?: any) => ({
      from: (_t: any) => makeChain(),
    }),
  };

  return { db, ops };
}

describe("court-rules service", () => {
  describe("searchRules", () => {
    it("returns rules with isBookmarked=false when no userId provided", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [
            {
              id: "r-1",
              jurisdiction: "FRCP",
              ruleNumber: "12(b)(6)",
              title: "Failure to State a Claim",
              body: "body",
              category: "procedural",
              citationShort: "Fed. R. Civ. P. 12(b)(6)",
              citationFull: "Federal Rule of Civil Procedure 12(b)(6)",
              sourceUrl: null,
              parentRuleId: null,
              sortOrder: 0,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        ],
      });
      const out = await searchRules(db, { text: "claim" });
      expect(out.length).toBe(1);
      expect(out[0].isBookmarked).toBe(false);
      expect(out[0].bookmarkNotes).toBeNull();
      expect(out[0].ruleNumber).toBe("12(b)(6)");
    });

    it("returns isBookmarked=true when bookmark join finds a match", async () => {
      const baseRule = {
        id: "r-1",
        jurisdiction: "FRCP",
        ruleNumber: "26",
        title: "Discovery",
        body: "body",
        category: "procedural",
        citationShort: "Fed. R. Civ. P. 26",
        citationFull: "Federal Rule of Civil Procedure 26",
        sourceUrl: null,
        parentRuleId: null,
        sortOrder: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { db } = makeMockDb({
        selectRows: [
          [baseRule],
          [{ ruleId: "r-1", notes: "important" }],
        ],
      });
      const out = await searchRules(db, { text: "discovery" }, "user-1");
      expect(out.length).toBe(1);
      expect(out[0].isBookmarked).toBe(true);
      expect(out[0].bookmarkNotes).toBe("important");
    });

    it("returns only bookmarked rules when bookmarkedBy is set", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [
            {
              rule: {
                id: "r-1",
                jurisdiction: "FRE",
                ruleNumber: "403",
                title: "Prejudice",
                body: "b",
                category: "evidence",
                citationShort: "Fed. R. Evid. 403",
                citationFull: "Federal Rule of Evidence 403",
                sourceUrl: null,
                parentRuleId: null,
                sortOrder: 0,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              bookmarkNotes: "key impeachment rule",
            },
          ],
        ],
      });
      const out = await searchRules(db, { bookmarkedBy: "user-1" });
      expect(out.length).toBe(1);
      expect(out[0].isBookmarked).toBe(true);
      expect(out[0].bookmarkNotes).toBe("key impeachment rule");
    });

    it("returns empty array when no rules match (skips bookmark join)", async () => {
      const { db } = makeMockDb({ selectRows: [[]] });
      const out = await searchRules(db, { text: "nope" }, "user-1");
      expect(out).toEqual([]);
    });
  });

  describe("getRule", () => {
    it("returns null when rule not found", async () => {
      const { db } = makeMockDb({ selectRows: [[]] });
      const out = await getRule(db, "missing");
      expect(out).toBeNull();
    });

    it("returns rule with parent and children", async () => {
      const baseRule = {
        id: "r-1",
        jurisdiction: "FRCP",
        ruleNumber: "12(b)(6)",
        title: "Failure",
        body: "b",
        category: "procedural",
        citationShort: "Fed. R. Civ. P. 12(b)(6)",
        citationFull: "Federal Rule of Civil Procedure 12(b)(6)",
        sourceUrl: null,
        parentRuleId: "r-parent",
        sortOrder: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const parent = { ...baseRule, id: "r-parent", ruleNumber: "12", parentRuleId: null };
      const { db } = makeMockDb({
        selectRows: [
          [baseRule], // get rule
          [parent], // parent lookup
          [], // children
        ],
      });
      const out = await getRule(db, "r-1");
      expect(out).not.toBeNull();
      expect(out!.parent?.id).toBe("r-parent");
      expect(out!.children).toEqual([]);
      expect(out!.isBookmarked).toBe(false);
    });
  });

  describe("addBookmark", () => {
    it("inserts and is idempotent on conflict (notes update)", async () => {
      const { db, ops } = makeMockDb({ insertReturnId: "bm-1" });
      const out = await addBookmark(db, "user-1", "rule-1", "my note");
      expect(out.id).toBe("bm-1");
      const conflict = ops.find((o) => o.kind === "insert-on-conflict");
      expect(conflict).toBeDefined();
      expect(conflict!.values.userId).toBe("user-1");
      expect(conflict!.values.ruleId).toBe("rule-1");
      expect(conflict!.values.notes).toBe("my note");
    });

    it("accepts null notes", async () => {
      const { db, ops } = makeMockDb({ insertReturnId: "bm-2" });
      await addBookmark(db, "user-1", "rule-2");
      const conflict = ops.find((o) => o.kind === "insert-on-conflict")!;
      expect(conflict.values.notes).toBeNull();
    });
  });

  describe("removeBookmark", () => {
    it("issues a delete", async () => {
      const { db, ops } = makeMockDb();
      await removeBookmark(db, "user-1", "rule-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
  });

  describe("listBookmarks", () => {
    it("returns ordered bookmarks with rule data", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [
            {
              bookmark: {
                id: "bm-1",
                userId: "user-1",
                ruleId: "r-1",
                notes: "n",
                createdAt: new Date("2026-04-20"),
              },
              rule: {
                id: "r-1",
                jurisdiction: "FRCP",
                ruleNumber: "26",
                title: "Discovery",
                body: "b",
                category: "procedural",
                citationShort: "Fed. R. Civ. P. 26",
                citationFull: "F.",
                sourceUrl: null,
                parentRuleId: null,
                sortOrder: 0,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            },
          ],
        ],
      });
      const out = await listBookmarks(db, "user-1");
      expect(out.length).toBe(1);
      expect(out[0].bookmarkId).toBe("bm-1");
      expect(out[0].rule.ruleNumber).toBe("26");
      expect(out[0].notes).toBe("n");
    });
  });

  describe("listJurisdictions", () => {
    it("returns jurisdiction counts", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [
            { jurisdiction: "FRCP", ruleCount: 50 },
            { jurisdiction: "FRE", ruleCount: 30 },
            { jurisdiction: "CA", ruleCount: 25 },
          ],
        ],
      });
      const out = await listJurisdictions(db);
      expect(out.length).toBe(3);
      expect(out[0]).toEqual({ jurisdiction: "FRCP", ruleCount: 50 });
      expect(out[1]).toEqual({ jurisdiction: "FRE", ruleCount: 30 });
    });
  });
});
