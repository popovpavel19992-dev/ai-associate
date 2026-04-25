// tests/unit/deposition-prep-service.test.ts
//
// Unit tests for the deposition-prep service. Hand-rolled mock db (same
// pattern as voir-dire-service.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOutline,
  getNextOutlineNumber,
  finalizeOutline,
  deleteOutline,
  updateOutlineMeta,
  addTopic,
  addTopicFromTemplate,
  addQuestion,
  updateQuestion,
  reorderTopics,
  reorderQuestions,
  __testing,
} from "@/server/services/deposition-prep/service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: {
  selectRows?: any[][];
  insertReturnIds?: string[];
} = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];
  const insertQueue = [...(opts.insertReturnIds ?? [])];

  const db: any = {
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [
            { id: insertQueue.shift() ?? "row-1" },
          ],
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

describe("deposition-prep service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("bodiesEqual", () => {
    it("matches identical text", () => {
      expect(__testing.bodiesEqual("a b c", "a b c")).toBe(true);
    });
    it("normalizes whitespace", () => {
      expect(__testing.bodiesEqual("  a  b\n\nc ", "a b c")).toBe(true);
    });
    it("detects substantive change", () => {
      expect(__testing.bodiesEqual("a b c", "a B c")).toBe(false);
    });
  });

  describe("createOutline", () => {
    it("inserts with status='draft' and returns id", async () => {
      const { db, ops } = makeMockDb({ insertReturnIds: ["o-1"] });
      const out = await createOutline(db, {
        orgId: "org-1",
        caseId: "case-1",
        servingParty: "plaintiff",
        deponentName: "John Smith",
        deponentRole: "party_witness",
        outlineNumber: 1,
        title: "Deposition Outline for John Smith — Initial",
        createdBy: "user-1",
      });
      expect(out.id).toBe("o-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.status).toBe("draft");
      expect(ins.values.outlineNumber).toBe(1);
      expect(ins.values.deponentRole).toBe("party_witness");
    });
  });

  describe("getNextOutlineNumber", () => {
    it("returns 1 when none exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: null }]] });
      const n = await getNextOutlineNumber(db, "case-1", "John Smith");
      expect(n).toBe(1);
    });
    it("returns max+1 when prior outlines exist", async () => {
      const { db } = makeMockDb({ selectRows: [[{ maxN: 3 }]] });
      const n = await getNextOutlineNumber(db, "case-1", "John Smith");
      expect(n).toBe(4);
    });
  });

  describe("finalizeOutline", () => {
    it("blocks when status != 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "finalized" }]] });
      await expect(finalizeOutline(db, "o-1")).rejects.toThrow(/draft/);
    });
    it("blocks when no topics", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft" }], []],
      });
      await expect(finalizeOutline(db, "o-1")).rejects.toThrow(/no topics/);
    });
    it("blocks when zero questions across topics", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft" }], [{ id: "t-1" }], []],
      });
      await expect(finalizeOutline(db, "o-1")).rejects.toThrow(/no questions/);
    });
    it("transitions draft → finalized", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ status: "draft" }],
          [{ id: "t-1" }],
          [{ id: "q-1" }],
        ],
      });
      await finalizeOutline(db, "o-1");
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.status).toBe("finalized");
      expect(upd.set.finalizedAt).toBeInstanceOf(Date);
    });
  });

  describe("deleteOutline", () => {
    it("hard-deletes draft outlines", async () => {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
      await deleteOutline(db, "o-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
    it("hard-deletes finalized outlines too (work product, never filed)", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "finalized" }]],
      });
      await deleteOutline(db, "o-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    });
  });

  describe("updateOutlineMeta", () => {
    it("only allowed when draft", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "finalized" }]] });
      await expect(
        updateOutlineMeta(db, "o-1", { title: "x" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("addTopic", () => {
    it("auto-orders to 1 when empty", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft" }], [{ maxN: null }]],
        insertReturnIds: ["t-1"],
      });
      const out = await addTopic(db, "o-1", {
        category: "background",
        title: "Witness Background",
      });
      expect(out.id).toBe("t-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.topicOrder).toBe(1);
    });
    it("blocks when outline not draft", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "finalized" }]] });
      await expect(
        addTopic(db, "o-1", { category: "background", title: "X" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("addTopicFromTemplate", () => {
    it("copies title, category, and inserts each question with source='library'", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // requireDraft (outer)
          [{ status: "draft" }],
          // getTemplate
          [
            {
              id: "tpl-1",
              category: "foundation",
              title: "Expert Qualifications & Methodology",
              questions: [
                "Please describe your professional background.",
                "What materials did you review?",
              ],
            },
          ],
          // addTopic → requireDraft
          [{ status: "draft" }],
          // addTopic → max(topicOrder)
          [{ maxN: null }],
        ],
        insertReturnIds: ["t-1", "q-1", "q-2"],
      });
      const out = await addTopicFromTemplate(db, "o-1", "tpl-1");
      expect(out.id).toBe("t-1");
      expect(out.questionIds).toEqual(["q-1", "q-2"]);
      const inserts = ops.filter((o) => o.kind === "insert");
      // 1 topic + 2 questions
      expect(inserts.length).toBe(3);
      expect(inserts[1].values.source).toBe("library");
      expect(inserts[1].values.sourceTemplateId).toBe("tpl-1");
      expect(inserts[1].values.text).toBe(
        "Please describe your professional background.",
      );
      expect(inserts[1].values.questionOrder).toBe(1);
      expect(inserts[2].values.questionOrder).toBe(2);
    });
  });

  describe("addQuestion", () => {
    it("auto-orders to 1 when empty", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // getTopicRow
          [{ id: "t-1", outlineId: "o-1" }],
          // requireDraft
          [{ status: "draft" }],
          // max(questionOrder)
          [{ maxN: null }],
        ],
        insertReturnIds: ["q-1"],
      });
      const out = await addQuestion(db, "t-1", { text: "What is your name?" });
      expect(out.id).toBe("q-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.questionOrder).toBe(1);
      expect(ins.values.source).toBe("manual");
      expect(ins.values.priority).toBe("important");
      expect(ins.values.exhibitRefs).toEqual([]);
    });
  });

  describe("updateQuestion — modify-flip", () => {
    it("flips library → modified when text changes substantively", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // getQuestionRow
          [
            {
              id: "q-1",
              topicId: "t-1",
              source: "library",
              sourceTemplateId: "tpl-1",
            },
          ],
          // getTopicRow
          [{ id: "t-1", outlineId: "o-1" }],
          // requireDraft (outline)
          [{ status: "draft" }],
          // getTemplate (modify-flip check)
          [
            {
              id: "tpl-1",
              questions: [
                "Please describe your professional background.",
                "What materials did you review?",
              ],
            },
          ],
        ],
      });
      await updateQuestion(db, "q-1", {
        text: "Please describe your background and qualifications IN DETAIL.",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("modified");
    });

    it("stays library when only whitespace differs", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "q-1",
              topicId: "t-1",
              source: "library",
              sourceTemplateId: "tpl-1",
            },
          ],
          [{ id: "t-1", outlineId: "o-1" }],
          [{ status: "draft" }],
          [
            {
              id: "tpl-1",
              questions: ["Please describe your professional background."],
            },
          ],
        ],
      });
      await updateQuestion(db, "q-1", {
        text: "  Please   describe   your\n\nprofessional background.  ",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("library");
    });

    it("flips modified → library when revert matches template", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "q-1",
              topicId: "t-1",
              source: "modified",
              sourceTemplateId: "tpl-1",
            },
          ],
          [{ id: "t-1", outlineId: "o-1" }],
          [{ status: "draft" }],
          [
            {
              id: "tpl-1",
              questions: ["Original verbatim text."],
            },
          ],
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
              topicId: "t-1",
              source: "manual",
              sourceTemplateId: null,
            },
          ],
          [{ id: "t-1", outlineId: "o-1" }],
          [{ status: "draft" }],
        ],
      });
      await updateQuestion(db, "q-1", { text: "edited" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBeUndefined();
      expect(upd.set.text).toBe("edited");
    });

    it("blocks when outline not draft", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [{ id: "q-1", topicId: "t-1", source: "manual", sourceTemplateId: null }],
          [{ id: "t-1", outlineId: "o-1" }],
          [{ status: "finalized" }],
        ],
      });
      await expect(
        updateQuestion(db, "q-1", { text: "x" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("reorderTopics", () => {
    it("two-pass scratch + commit", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft" }]],
      });
      await reorderTopics(db, "o-1", ["a", "b", "c"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(6);
      expect(updates[0].set.topicOrder).toBeGreaterThan(5000);
      expect(updates[3].set.topicOrder).toBe(1);
      expect(updates[5].set.topicOrder).toBe(3);
    });
  });

  describe("reorderQuestions", () => {
    it("blocked when outline not draft", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [{ id: "t-1", outlineId: "o-1" }],
          [{ status: "finalized" }],
        ],
      });
      await expect(
        reorderQuestions(db, "t-1", ["a", "b"]),
      ).rejects.toThrow(/draft/);
    });
    it("two-pass scratch + commit when draft", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ id: "t-1", outlineId: "o-1" }],
          [{ status: "draft" }],
        ],
      });
      await reorderQuestions(db, "t-1", ["a", "b"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(4);
      expect(updates[0].set.questionOrder).toBeGreaterThan(5000);
      expect(updates[2].set.questionOrder).toBe(1);
    });
  });
});
