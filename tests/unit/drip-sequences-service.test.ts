// tests/unit/drip-sequences-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSequence,
  enrollContact,
  cancelEnrollment,
  cancelEnrollmentsForContact,
  advanceEnrollment,
  dueEnrollments,
} from "@/server/services/drip-sequences/service";

type Op = { kind: string; table?: any; values?: any; set?: any; where?: any };

function makeMockDb(opts: {
  // For enrollContact: configure first-step lookup, sequence lookup, and insert behavior.
  sequence?: { id: string; orgId: string; isActive: boolean } | null;
  firstStep?: { delayDays: number } | null;
  // For advanceEnrollment
  enrollment?: { id: string; sequenceId: string; currentStepOrder: number; status: string } | null;
  nextStep?: { delayDays: number } | null;
  insertReturnId?: string;
  insertThrowsUnique?: boolean;
  // For cancelEnrollmentsForContact: count of returned IDs.
  bulkCancelReturned?: number;
  // For dueEnrollments
  dueRows?: any[];
} = {}) {
  const ops: Op[] = [];
  let selectCallNum = 0;

  const db: any = {
    transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
    insert: (table: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", table, values: v });
        if (opts.insertThrowsUnique) {
          const e: any = new Error("duplicate key value violates unique constraint");
          e.code = "23505";
          throw e;
        }
        return {
          returning: async () => [{ id: opts.insertReturnId ?? "new-id-1" }],
        };
      },
    }),
    update: (table: any) => ({
      set: (s: any) => ({
        where: (w: any) => {
          const update: any = { kind: "update", table, set: s, where: w };
          ops.push(update);
          // .returning() chain (used by cancelEnrollmentsForContact).
          const out: any = Promise.resolve();
          out.returning = async () => {
            const n = opts.bulkCancelReturned ?? 0;
            return Array.from({ length: n }, (_, i) => ({ id: `cancelled-${i}` }));
          };
          return out;
        },
      }),
    }),
    delete: (table: any) => ({
      where: (w: any) => {
        ops.push({ kind: "delete", table, where: w });
        return Promise.resolve();
      },
    }),
    select: (_cols?: any) => ({
      from: (_table: any) => ({
        where: (_w: any) => {
          const chain: any = {
            orderBy: (_o: any) => ({
              limit: async (_n: number) => {
                selectCallNum++;
                // 1st select inside enrollContact = sequence lookup
                if (selectCallNum === 1 && opts.sequence !== undefined) {
                  return opts.sequence ? [opts.sequence] : [];
                }
                // 2nd select inside enrollContact = firstStep lookup
                if (selectCallNum === 2 && opts.firstStep !== undefined) {
                  return opts.firstStep ? [opts.firstStep] : [];
                }
                if (opts.dueRows) return opts.dueRows;
                return [];
              },
            }),
            limit: async (_n: number) => {
              selectCallNum++;
              // For advanceEnrollment: 1st select = enrollment, 2nd = nextStep
              if (selectCallNum === 1 && opts.enrollment !== undefined) {
                return opts.enrollment ? [opts.enrollment] : [];
              }
              if (selectCallNum === 2 && opts.nextStep !== undefined) {
                return opts.nextStep ? [opts.nextStep] : [];
              }
              if (selectCallNum === 1 && opts.sequence !== undefined) {
                return opts.sequence ? [opts.sequence] : [];
              }
              return [];
            },
          };
          return chain;
        },
      }),
    }),
  };

  return { db, ops };
}

describe("drip-sequences service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  describe("createSequence", () => {
    it("inserts sequence and steps in order inside a transaction", async () => {
      const { db, ops } = makeMockDb({ insertReturnId: "seq-1" });
      const result = await createSequence(db, {
        orgId: "org-1",
        createdBy: "user-1",
        name: "Welcome",
        description: "Onboarding",
        steps: [
          { templateId: "t-a", delayDays: 0 },
          { templateId: "t-b", delayDays: 3 },
          { templateId: "t-c", delayDays: 7 },
        ],
      });

      expect(result.id).toBe("seq-1");
      const inserts = ops.filter((o) => o.kind === "insert");
      expect(inserts).toHaveLength(2);
      // Second insert is the steps batch.
      const stepsBatch = inserts[1].values as any[];
      expect(stepsBatch).toHaveLength(3);
      expect(stepsBatch.map((s) => s.stepOrder)).toEqual([0, 1, 2]);
      expect(stepsBatch.map((s) => s.templateId)).toEqual(["t-a", "t-b", "t-c"]);
      expect(stepsBatch.map((s) => s.delayDays)).toEqual([0, 3, 7]);
    });

    it("throws on empty steps array", async () => {
      const { db } = makeMockDb();
      await expect(
        createSequence(db, {
          orgId: "org-1",
          createdBy: "user-1",
          name: "x",
          steps: [],
        }),
      ).rejects.toThrow(/at least one step/i);
    });
  });

  describe("enrollContact", () => {
    it("computes firstSendAt = now + step[0].delayDays", async () => {
      const { db, ops } = makeMockDb({
        sequence: { id: "seq-1", orgId: "org-1", isActive: true },
        firstStep: { delayDays: 3 },
        insertReturnId: "enr-1",
      });

      const result = await enrollContact(db, {
        sequenceId: "seq-1",
        orgId: "org-1",
        clientContactId: "cc-1",
        enrolledBy: "user-1",
      });

      expect(result.enrollmentId).toBe("enr-1");
      // 2026-04-24 + 3 days = 2026-04-27
      expect(result.firstSendAt.toISOString()).toBe("2026-04-27T12:00:00.000Z");
      const insert = ops.find((o) => o.kind === "insert");
      expect(insert).toBeTruthy();
      expect((insert!.values as any).status).toBe("active");
      expect((insert!.values as any).currentStepOrder).toBe(0);
    });

    it("throws when sequence has 0 steps", async () => {
      const { db } = makeMockDb({
        sequence: { id: "seq-1", orgId: "org-1", isActive: true },
        firstStep: null,
      });
      await expect(
        enrollContact(db, {
          sequenceId: "seq-1",
          orgId: "org-1",
          clientContactId: "cc-1",
          enrolledBy: "user-1",
        }),
      ).rejects.toThrow(/no steps/i);
    });

    it("translates PG 23505 unique violation into CONFLICT 'already enrolled'", async () => {
      const { db } = makeMockDb({
        sequence: { id: "seq-1", orgId: "org-1", isActive: true },
        firstStep: { delayDays: 0 },
        insertThrowsUnique: true,
      });
      await expect(
        enrollContact(db, {
          sequenceId: "seq-1",
          orgId: "org-1",
          clientContactId: "cc-1",
          enrolledBy: "user-1",
        }),
      ).rejects.toThrow(/already enrolled/i);
    });

    it("throws NOT_FOUND when sequence is in another org", async () => {
      const { db } = makeMockDb({
        sequence: { id: "seq-1", orgId: "other-org", isActive: true },
        firstStep: { delayDays: 0 },
      });
      await expect(
        enrollContact(db, {
          sequenceId: "seq-1",
          orgId: "org-1",
          clientContactId: "cc-1",
          enrolledBy: "user-1",
        }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("cancelEnrollment", () => {
    it("sets status, cancelled_at, clears next_send_at", async () => {
      const { db, ops } = makeMockDb();
      await cancelEnrollment(db, "enr-1", "manual");
      const upd = ops.find((o) => o.kind === "update");
      expect(upd).toBeTruthy();
      const set = upd!.set as any;
      expect(set.status).toBe("cancelled_manual");
      expect(set.cancelledAt).toBeInstanceOf(Date);
      expect(set.nextSendAt).toBeNull();
    });

    it("uses correct status string for each reason", async () => {
      for (const reason of ["reply", "bounce", "complaint", "manual"] as const) {
        const { db, ops } = makeMockDb();
        await cancelEnrollment(db, "enr-1", reason);
        const upd = ops.find((o) => o.kind === "update");
        expect((upd!.set as any).status).toBe(`cancelled_${reason}`);
      }
    });
  });

  describe("cancelEnrollmentsForContact", () => {
    it("returns count of cancelled rows", async () => {
      const { db } = makeMockDb({ bulkCancelReturned: 3 });
      const n = await cancelEnrollmentsForContact(db, "cc-1", "reply");
      expect(n).toBe(3);
    });
    it("returns 0 when nothing to cancel", async () => {
      const { db } = makeMockDb({ bulkCancelReturned: 0 });
      const n = await cancelEnrollmentsForContact(db, "cc-1", "bounce");
      expect(n).toBe(0);
    });
  });

  describe("advanceEnrollment", () => {
    it("transitions to next step with new nextSendAt", async () => {
      const { db, ops } = makeMockDb({
        enrollment: { id: "enr-1", sequenceId: "seq-1", currentStepOrder: 0, status: "active" },
        nextStep: { delayDays: 5 },
      });
      await advanceEnrollment(db, "enr-1");
      const upd = ops.find((o) => o.kind === "update");
      expect(upd).toBeTruthy();
      const set = upd!.set as any;
      expect(set.currentStepOrder).toBe(1);
      expect(set.nextSendAt.toISOString()).toBe("2026-04-29T12:00:00.000Z");
      expect(set.lastStepSentAt).toBeInstanceOf(Date);
      expect(set.status).toBeUndefined();
    });

    it("marks complete when no next step exists", async () => {
      const { db, ops } = makeMockDb({
        enrollment: { id: "enr-1", sequenceId: "seq-1", currentStepOrder: 2, status: "active" },
        nextStep: null,
      });
      await advanceEnrollment(db, "enr-1");
      const upd = ops.find((o) => o.kind === "update");
      const set = upd!.set as any;
      expect(set.status).toBe("completed");
      expect(set.completedAt).toBeInstanceOf(Date);
      expect(set.nextSendAt).toBeNull();
      expect(set.currentStepOrder).toBe(3);
    });

    it("no-op when enrollment is already terminal", async () => {
      const { db, ops } = makeMockDb({
        enrollment: { id: "enr-1", sequenceId: "seq-1", currentStepOrder: 5, status: "completed" },
      });
      await advanceEnrollment(db, "enr-1");
      // No update should be issued.
      expect(ops.filter((o) => o.kind === "update")).toHaveLength(0);
    });
  });

  describe("dueEnrollments", () => {
    it("returns mapped rows", async () => {
      const { db } = makeMockDb({
        dueRows: [
          {
            id: "enr-1",
            sequenceId: "seq-1",
            clientContactId: "cc-1",
            caseId: null,
            orgId: "org-1",
            currentStepOrder: 1,
            nextSendAt: new Date("2026-04-24T11:00:00.000Z"),
          },
          {
            id: "enr-2",
            sequenceId: "seq-2",
            clientContactId: "cc-2",
            caseId: "case-1",
            orgId: "org-1",
            currentStepOrder: 0,
            nextSendAt: new Date("2026-04-24T11:30:00.000Z"),
          },
        ],
      });
      const rows = await dueEnrollments(db, new Date("2026-04-24T12:00:00.000Z"), 100);
      expect(rows).toHaveLength(2);
      expect(rows[0].enrollmentId).toBe("enr-1");
      expect(rows[1].caseId).toBe("case-1");
      // nextSendAt is stripped in the output projection.
      expect((rows[0] as any).nextSendAt).toBeUndefined();
    });
  });
});
