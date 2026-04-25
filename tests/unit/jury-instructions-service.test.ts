// tests/unit/jury-instructions-service.test.ts
//
// Unit tests for the jury-instructions service. Hand-rolled mock db (same pattern
// as exhibit-lists-service.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSet,
  getNextSetNumber,
  finalizeSet,
  markSubmitted,
  deleteSet,
  updateSetMeta,
  addInstruction,
  addInstructionFromTemplate,
  updateInstruction,
  reorderInstructions,
  __testing,
} from "@/server/services/jury-instructions/service";

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

describe("jury-instructions service", () => {
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
      expect(__testing.bodiesEqual("foo bar", "foo barx")).toBe(false);
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
        title: "Plaintiff's Proposed Jury Instructions",
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
    it("throws when set has zero instructions", async () => {
      const { db } = makeMockDb({
        selectRows: [[{ status: "draft" }], []],
      });
      await expect(finalizeSet(db, "set-1")).rejects.toThrow(/no instructions/);
    });
    it("transitions draft → final and stamps finalizedAt", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft" }], [{ id: "i-1" }]],
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

  describe("addInstruction", () => {
    it("blocks when set is not 'draft'", async () => {
      const { db } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        addInstruction(db, "set-1", {
          category: "preliminary",
          instructionNumber: "1.1",
          title: "Duty",
          body: "Body",
        }),
      ).rejects.toThrow(/draft/);
    });

    it("auto-assigns instructionOrder=1 when none exist", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ status: "draft", servingParty: "plaintiff" }],
          [{ maxN: null }],
        ],
        insertReturnId: "i-1",
      });
      const out = await addInstruction(db, "set-1", {
        category: "preliminary",
        instructionNumber: "1.1",
        title: "Duty",
        body: "Body",
      });
      expect(out.id).toBe("i-1");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.instructionOrder).toBe(1);
      expect(ins.values.source).toBe("manual");
      expect(ins.values.partyPosition).toBe("plaintiff_proposed");
    });

    it("defaults partyPosition based on servingParty (defendant)", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [{ status: "draft", servingParty: "defendant" }],
          [{ maxN: 2 }],
        ],
        insertReturnId: "i-3",
      });
      await addInstruction(db, "set-1", {
        category: "concluding",
        instructionNumber: "9.1",
        title: "Deliberate",
        body: "Body",
      });
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.instructionOrder).toBe(3);
      expect(ins.values.partyPosition).toBe("defendant_proposed");
    });
  });

  describe("addInstructionFromTemplate", () => {
    it("copies body verbatim and sets source='library'", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // requireDraft → set row
          [{ status: "draft", servingParty: "plaintiff" }],
          // getTemplate → template row
          [
            {
              id: "tpl-1",
              category: "preliminary",
              instructionNumber: "1.1",
              title: "Duty of the Jury",
              body: "It is your duty…",
            },
          ],
          // addInstruction → requireDraft (set row again)
          [{ status: "draft", servingParty: "plaintiff" }],
          // max(order)
          [{ maxN: null }],
        ],
        insertReturnId: "i-7",
      });
      const out = await addInstructionFromTemplate(db, "set-1", "tpl-1");
      expect(out.id).toBe("i-7");
      const ins = ops.find((o) => o.kind === "insert")!;
      expect(ins.values.source).toBe("library");
      expect(ins.values.sourceTemplateId).toBe("tpl-1");
      expect(ins.values.body).toBe("It is your duty…");
      expect(ins.values.title).toBe("Duty of the Jury");
    });
  });

  describe("updateInstruction — modified auto-flip", () => {
    it("flips library → modified when body changes substantively", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          // getInstructionRow
          [
            {
              id: "i-1",
              setId: "set-1",
              source: "library",
              sourceTemplateId: "tpl-1",
            },
          ],
          // requireDraft (set row)
          [{ status: "draft" }],
          // getTemplate
          [{ id: "tpl-1", body: "Original verbatim text." }],
        ],
      });
      await updateInstruction(db, "i-1", {
        body: "Original verbatim text WITH MY ADDITIONS.",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("modified");
      expect(upd.set.body).toBe("Original verbatim text WITH MY ADDITIONS.");
    });

    it("stays library when only whitespace differs", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "i-1",
              setId: "set-1",
              source: "library",
              sourceTemplateId: "tpl-1",
            },
          ],
          [{ status: "draft" }],
          [{ id: "tpl-1", body: "Original verbatim text." }],
        ],
      });
      await updateInstruction(db, "i-1", {
        body: "  Original   verbatim\n\ntext.  ",
      });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("library");
    });

    it("flips modified → library when body reverts to template", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "i-1",
              setId: "set-1",
              source: "modified",
              sourceTemplateId: "tpl-1",
            },
          ],
          [{ status: "draft" }],
          [{ id: "tpl-1", body: "Original verbatim text." }],
        ],
      });
      await updateInstruction(db, "i-1", { body: "Original verbatim text." });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBe("library");
    });

    it("does not touch source for manual rows (no sourceTemplateId)", async () => {
      const { db, ops } = makeMockDb({
        selectRows: [
          [
            {
              id: "i-1",
              setId: "set-1",
              source: "manual",
              sourceTemplateId: null,
            },
          ],
          [{ status: "draft" }],
        ],
      });
      await updateInstruction(db, "i-1", { body: "edited body" });
      const upd = ops.find((o) => o.kind === "update")!;
      expect(upd.set.source).toBeUndefined();
      expect(upd.set.body).toBe("edited body");
    });

    it("blocks when set is not draft", async () => {
      const { db } = makeMockDb({
        selectRows: [
          [{ id: "i-1", setId: "set-1", source: "manual", sourceTemplateId: null }],
          [{ status: "final" }],
        ],
      });
      await expect(
        updateInstruction(db, "i-1", { title: "x" }),
      ).rejects.toThrow(/draft/);
    });
  });

  describe("reorderInstructions", () => {
    it("two-pass scratch + commit, blocked when not draft", async () => {
      // Blocked path
      const { db: blocked } = makeMockDb({ selectRows: [[{ status: "final" }]] });
      await expect(
        reorderInstructions(blocked, "set-1", ["a", "b"]),
      ).rejects.toThrow(/draft/);

      // Happy path
      const { db, ops } = makeMockDb({
        selectRows: [[{ status: "draft", servingParty: "plaintiff" }]],
      });
      await reorderInstructions(db, "set-1", ["a", "b", "c"]);
      const updates = ops.filter((o) => o.kind === "update");
      expect(updates.length).toBe(6);
      expect(updates[0].set.instructionOrder).toBeGreaterThan(5000);
      expect(updates[3].set.instructionOrder).toBe(1);
      expect(updates[4].set.instructionOrder).toBe(2);
      expect(updates[5].set.instructionOrder).toBe(3);
    });
  });
});
