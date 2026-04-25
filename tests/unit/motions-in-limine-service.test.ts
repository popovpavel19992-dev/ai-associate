// tests/unit/motions-in-limine-service.test.ts
//
// Unit tests for the motions-in-limine service. Hand-rolled mock db (same
// pattern as jury-instructions-service.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSet,
  getNextSetNumber,
  finalizeSet,
  markSubmitted,
  deleteSet,
  updateSetMeta,
  addMil,
  addMilFromTemplate,
  updateMil,
  reorderMils,
  __testing,
} from "@/server/services/motions-in-limine/service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: { selectRows?: any[][]; insertReturnId?: string } = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];

  const db: any = {
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [{ id: opts.insertReturnId ?? "row-1" }],
        };
      },
    }),
    update: (_t: any) => ({
      set: (s: any) => ({
        where: (_w: any) => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
    delete: (_t: any) => ({
      where: (_w: any) => {
        ops.push({ kind: "delete" });
        return Promise.resolve();
      },
    }),
    select: (_cols?: any) => ({
      from: (_t: any) => {
        const buildWhere = () => {
          const next = selectQueue.shift() ?? [];
          const chain: any = {
            limit: async (_n: number) => next,
            orderBy: (..._args: any[]) => ({
              limit: async (_n: number) => next,
              then: (resolve: any, reject: any) =>
                Promise.resolve(next).then(resolve, reject),
            }),
            then: (resolve: any, reject: any) =>
              Promise.resolve(next).then(resolve, reject),
          };
          return chain;
        };
        return {
          where: (_w: any) => buildWhere(),
          orderBy: (..._args: any[]) => ({
            then: (resolve: any, reject: any) =>
              Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
          }),
        };
      },
    }),
  };

  return { db, ops };
}

describe("motions-in-limine service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("textEqual / allSectionsMatch (whitespace-normalized)", () => {
    it("treats identical text as equal", () => {
      expect(__testing.textEqual("foo bar", "foo bar")).toBe(true);
    });
    it("ignores trailing/leading whitespace and collapses internal", () => {
      expect(__testing.textEqual("  foo   bar\n\nbaz  ", "foo bar baz")).toBe(true);
    });
    it("detects substantive word change", () => {
      expect(__testing.textEqual("foo bar", "foo barx")).toBe(false);
    });
    it("allSectionsMatch: all four sections equal", () => {
      const tpl = { introduction: "a", reliefSought: "b", legalAuthority: "c", conclusion: "d" };
      expect(__testing.allSectionsMatch({ ...tpl }, tpl)).toBe(true);
    });
    it("allSectionsMatch: any single section differing returns false", () => {
      const tpl = { introduction: "a", reliefSought: "b", legalAuthority: "c", conclusion: "d" };
      expect(
        __testing.allSectionsMatch({ ...tpl, conclusion: "DIFFERENT" }, tpl),
      ).toBe(false);
    });
  });

  describe("createSet", () => {
    it("inserts with status='draft' and returns id", async () => {
      const { db, ops } = makeMockDb({ insertReturnId: "set-1" });
      const out = await createSet(db, {
        orgId: "org-1",
        caseId: "case-1",
        servingParty: "plaintiff",
        setNumber: 1,
        title: "Plaintiff's Motions in Limine — First Set",
        createdBy: "user-1",
      });
      expect(out.id).toBe("set-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.status).toBe("draft");
      expect(ins.values.setNumber).toBe(1);
    });
  });

  describe("getNextSetNumber", () => {
    it("returns 1 when none exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: null }]] });
      const n = await getNextSetNumber(db, "case-1", "plaintiff");
      expect(n).toBe(1);
    });
    it("returns max+1 when sets exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: 2 }]] });
      const n = await getNextSetNumber(db, "case-1", "defendant");
      expect(n).toBe(3);
    });
  });

  describe("finalizeSet", () => {
    it("throws when status != 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(finalizeSet(db, "set-1")).rejects.toThrow(/draft/);
    });
    it("throws when set has zero MILs", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft" }], []],
      });
      await expect(finalizeSet(db, "set-1")).rejects.toThrow(/no MILs/);
    });
    it("transitions draft → final and stamps finalizedAt", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft" }], [{ id: "m-1" }]],
      });
      await finalizeSet(db, "set-1");
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("final");
      expect(upd.set.finalizedAt).toBeInstanceOf(Date);
    });
  });

  describe("markSubmitted", () => {
    it("throws when status != 'final'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await expect(markSubmitted(db, "set-1", new Date())).rejects.toThrow(
        /finalized/,
      );
    });
    it("transitions final → submitted", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      const at = new Date("2026-04-30T10:00:00.000Z");
      await markSubmitted(db, "set-1", at);
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("submitted");
      expect(upd.set.submittedAt).toBe(at);
    });
  });

  describe("deleteSet", () => {
    it("blocks delete when status='submitted'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "submitted" }]] });
      await expect(deleteSet(db, "set-1")).rejects.toThrow(/Submitted/);
    });
    it("hard-deletes when status='draft'", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await deleteSet(db, "set-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
  });

  describe("updateSetMeta", () => {
    it("only allowed when status='draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        updateSetMeta(db, "set-1", { title: "x" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("addMil", () => {
    it("blocks when set is not 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        addMil(db, "set-1", {
          category: "exclude_prior_bad_acts",
          title: "MIL",
          introduction: "i",
          reliefSought: "r",
          legalAuthority: "a",
          conclusion: "c",
        }),
      ).rejects.toThrow(/draft/);
    });

    it("auto-assigns milOrder=1 when none exist", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ status: "draft", servingParty: "plaintiff" }],
          [{ maxN: null }],
        ],
        insertReturnId: "m-1",
      });
      const out = await addMil(db, "set-1", {
        category: "daubert",
        freRule: "702",
        title: "MIL",
        introduction: "i",
        reliefSought: "r",
        legalAuthority: "a",
        conclusion: "c",
      });
      expect(out.id).toBe("m-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.milOrder).toBe(1);
      expect(ins.values.source).toBe("manual");
      expect(ins.values.freRule).toBe("702");
    });
  });

  describe("addMilFromTemplate", () => {
    it("copies all 4 sections verbatim and sets source='library'", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // requireDraft → set
          [{ status: "draft", servingParty: "plaintiff" }],
          // getTemplate → tpl
          [
            {
              id: "tpl-1",
              category: "hearsay",
              freRule: "802",
              title: "MIL Hearsay",
              introduction: "intro text",
              reliefSought: "relief text",
              legalAuthority: "authority text",
              conclusion: "conclusion text",
            },
          ],
          // addMil → requireDraft
          [{ status: "draft", servingParty: "plaintiff" }],
          // max(order)
          [{ maxN: null }],
        ],
        insertReturnId: "m-7",
      });
      const out = await addMilFromTemplate(db, "set-1", "tpl-1");
      expect(out.id).toBe("m-7");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.source).toBe("library");
      expect(ins.values.sourceTemplateId).toBe("tpl-1");
      expect(ins.values.introduction).toBe("intro text");
      expect(ins.values.reliefSought).toBe("relief text");
      expect(ins.values.legalAuthority).toBe("authority text");
      expect(ins.values.conclusion).toBe("conclusion text");
      expect(ins.values.freRule).toBe("802");
    });
  });

  describe("updateMil — modified auto-flip on any-section change", () => {
    const tplBody = {
      id: "tpl-1",
      introduction: "INTRO",
      reliefSought: "RELIEF",
      legalAuthority: "AUTH",
      conclusion: "CONCL",
    };
    const rowAtTemplate = {
      id: "m-1",
      setId: "set-1",
      source: "library",
      sourceTemplateId: "tpl-1",
      introduction: "INTRO",
      reliefSought: "RELIEF",
      legalAuthority: "AUTH",
      conclusion: "CONCL",
    };

    it("flips library → modified when ANY single section changes (legalAuthority)", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [rowAtTemplate],
          [{ status: "draft" }],
          [tplBody],
        ],
      });
      await updateMil(db, "m-1", { legalAuthority: "AUTH plus my own additions" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("modified");
    });

    it("stays library when only whitespace differs across sections", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [rowAtTemplate],
          [{ status: "draft" }],
          [tplBody],
        ],
      });
      await updateMil(db, "m-1", {
        introduction: "  INTRO  ",
        conclusion: "CONCL\n\n",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("library");
    });

    it("flips modified → library when all 4 sections revert to template", async () => {
      const modifiedRow = { ...rowAtTemplate, source: "modified", introduction: "edited" };
      const { db, ops } = makeMockDb({
        selectRows: [
          [modifiedRow],
          [{ status: "draft" }],
          [tplBody],
        ],
      });
      await updateMil(db, "m-1", { introduction: "INTRO" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("library");
    });

    it("does not touch source for manual rows (no sourceTemplateId)", async () => {
      const manualRow = {
        id: "m-1",
        setId: "set-1",
        source: "manual",
        sourceTemplateId: null,
        introduction: "i",
        reliefSought: "r",
        legalAuthority: "a",
        conclusion: "c",
      };
      const { db, ops } = makeMockDb({
        selectRows: [[manualRow], [{ status: "draft" }]],
      });
      await updateMil(db, "m-1", { introduction: "edited" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBeUndefined();
      expect(upd.set.introduction).toBe("edited");
    });

    it("title-only edit on library row leaves source untouched", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[rowAtTemplate], [{ status: "draft" }]],
      });
      await updateMil(db, "m-1", { title: "renamed" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBeUndefined();
      expect(upd.set.title).toBe("renamed");
    });

    it("blocks when set is not draft", async () => {
      const manualRow = {
        id: "m-1",
        setId: "set-1",
        source: "manual",
        sourceTemplateId: null,
        introduction: "i",
        reliefSought: "r",
        legalAuthority: "a",
        conclusion: "c",
      };
      const { db } = makeMockDb({
        selectRows: [[manualRow], [{ status: "final" }]],
      });
      await expect(
        updateMil(db, "m-1", { title: "x" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("reorderMils", () => {
    it("two-pass scratch + commit, blocked when not draft", async () => {
      const { db: blocked } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        reorderMils(blocked, "set-1", ["a", "b"]),
      ).rejects.toThrow(/draft/);

      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft", servingParty: "plaintiff" }]],
      });
      await reorderMils(db, "set-1", ["a", "b", "c"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(6);
      expect(updates[0].set.milOrder).toBeGreaterThan(5000);
      expect(updates[3].set.milOrder).toBe(1);
      expect(updates[4].set.milOrder).toBe(2);
      expect(updates[5].set.milOrder).toBe(3);
    });
  });
});
