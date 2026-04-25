// tests/unit/voir-dire-service.test.ts
//
// Unit tests for the voir-dire service. Hand-rolled mock db (same pattern
// as jury-instructions-service.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSet,
  getNextSetNumber,
  finalizeSet,
  markSubmitted,
  deleteSet,
  updateSetMeta,
  addQuestion,
  addQuestionFromTemplate,
  updateQuestion,
  reorderQuestions,
  __testing,
} from "@/server/services/voir-dire/service";

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

describe("voir-dire service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("bodiesEqual (whitespace-normalized comparison)", () => {
    it("treats identical text as equal", () => {
      expect(__testing.bodiesEqual("foo bar", "foo bar")).toBe(true);
    });
    it("ignores trailing/leading whitespace", () => {
      expect(__testing.bodiesEqual("  foo bar  ", "foo bar")).toBe(true);
    });
    it("collapses internal whitespace", () => {
      expect(__testing.bodiesEqual("foo   bar\n\nbaz", "foo bar baz")).toBe(true);
    });
    it("detects substantive word change", () => {
      expect(__testing.bodiesEqual("foo bar", "foo BAR")).toBe(false);
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
        title: "Plaintiff's Proposed Voir Dire Questions",
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
      const { db } = makeMockDb({ selectRows: [[{ maxN: 4 }]] });
      const n = await getNextSetNumber(db, "case-1", "defendant");
      expect(n).toBe(5);
    });
  });

  describe("finalizeSet", () => {
    it("throws when status != 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(finalizeSet(db, "set-1")).rejects.toThrow(/draft/);
    });
    it("throws when set has zero questions", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft" }], []],
      });
      await expect(finalizeSet(db, "set-1")).rejects.toThrow(/no questions/);
    });
    it("transitions draft → final and stamps finalizedAt", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft" }], [{ id: "q-1" }]],
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

  describe("addQuestion", () => {
    it("blocks when set is not 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        addQuestion(db, "set-1", {
          category: "background",
          text: "What is your name?",
        }),
      ).rejects.toThrow(/draft/);
    });

    it("auto-assigns questionOrder=1 when none exist", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ status: "draft", servingParty: "plaintiff" }],
          [{ maxN: null }],
        ],
        insertReturnId: "q-1",
      });
      const out = await addQuestion(db, "set-1", {
        category: "background",
        text: "What is your occupation?",
      });
      expect(out.id).toBe("q-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.questionOrder).toBe(1);
      expect(ins.values.source).toBe("manual");
      expect(ins.values.jurorPanelTarget).toBe("all");
      expect(ins.values.isForCause).toBe(false);
    });
  });

  describe("addQuestionFromTemplate", () => {
    it("copies text verbatim, follow-up, for-cause flag, and sets source='library'", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // requireDraft → set row
          [{ status: "draft", servingParty: "plaintiff" }],
          // getTemplate → template row
          [
            {
              id: "tpl-1",
              category: "attitudes_bias",
              text: "Are you generally inclined to believe one side?",
              followUpPrompt: "Please explain.",
              isForCause: true,
            },
          ],
          // addQuestion → requireDraft (set row again)
          [{ status: "draft", servingParty: "plaintiff" }],
          // max(order)
          [{ maxN: null }],
        ],
        insertReturnId: "q-7",
      });
      const out = await addQuestionFromTemplate(db, "set-1", "tpl-1");
      expect(out.id).toBe("q-7");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.source).toBe("library");
      expect(ins.values.sourceTemplateId).toBe("tpl-1");
      expect(ins.values.text).toBe("Are you generally inclined to believe one side?");
      expect(ins.values.followUpPrompt).toBe("Please explain.");
      expect(ins.values.isForCause).toBe(true);
    });
  });

  describe("updateQuestion — modified auto-flip", () => {
    it("flips library → modified when text changes substantively", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // getQuestionRow
          [
            {
              id: "q-1",
              setId: "set-1",
              source: "library",
              sourceTemplateId: "tpl-1",
            },
          ],
          // requireDraft (set row)
          [{ status: "draft" }],
          // getTemplate
          [{ id: "tpl-1", text: "Original verbatim text." }],
        ],
      });
      await updateQuestion(db, "q-1", {
        text: "Original verbatim text WITH MY ADDITIONS.",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("modified");
      expect(upd.set.text).toBe("Original verbatim text WITH MY ADDITIONS.");
    });

    it("stays library when only whitespace differs", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "q-1",
              setId: "set-1",
              source: "library",
              sourceTemplateId: "tpl-1",
            },
          ],
          [{ status: "draft" }],
          [{ id: "tpl-1", text: "Original verbatim text." }],
        ],
      });
      await updateQuestion(db, "q-1", {
        text: "  Original   verbatim\n\ntext.  ",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("library");
    });

    it("flips modified → library when text reverts to template", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "q-1",
              setId: "set-1",
              source: "modified",
              sourceTemplateId: "tpl-1",
            },
          ],
          [{ status: "draft" }],
          [{ id: "tpl-1", text: "Original verbatim text." }],
        ],
      });
      await updateQuestion(db, "q-1", { text: "Original verbatim text." });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("library");
    });

    it("does not touch source for manual rows", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "q-1",
              setId: "set-1",
              source: "manual",
              sourceTemplateId: null,
            },
          ],
          [{ status: "draft" }],
        ],
      });
      await updateQuestion(db, "q-1", { text: "edited text" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBeUndefined();
      expect(upd.set.text).toBe("edited text");
    });

    it("blocks when set is not draft", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [{ id: "q-1", setId: "set-1", source: "manual", sourceTemplateId: null }],
          [{ status: "final" }],
        ],
      });
      await expect(
        updateQuestion(db, "q-1", { text: "x" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("reorderQuestions", () => {
    it("two-pass scratch + commit, blocked when not draft", async () => {
      const { db: blocked } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        reorderQuestions(blocked, "set-1", ["a", "b"]),
      ).rejects.toThrow(/draft/);

      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft", servingParty: "plaintiff" }]],
      });
      await reorderQuestions(db, "set-1", ["a", "b", "c"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(6);
      expect(updates[0].set.questionOrder).toBeGreaterThan(5000);
      expect(updates[3].set.questionOrder).toBe(1);
      expect(updates[4].set.questionOrder).toBe(2);
      expect(updates[5].set.questionOrder).toBe(3);
    });
  });
});
