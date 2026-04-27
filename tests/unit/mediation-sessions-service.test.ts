// tests/unit/mediation-sessions-service.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSession,
  getNextSessionNumber,
  updateSession,
  markStatus,
  markOutcome,
  deleteSession,
} from "@/server/services/settlement/mediation-service";

type Op = { kind: string; values?: any; set?: any };

function makeMockDb(opts: { selectRows?: any[][]; insertReturn?: any } = {}) {
  const ops: Op[] = [];
  const selectQueue = [...(opts.selectRows ?? [])];
  const db: any = {
    insert: () => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [
            opts.insertReturn ?? { id: "row-1", sessionNumber: 1 },
          ],
        };
      },
    }),
    update: () => ({
      set: (s: any) => ({
        where: () => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        ops.push({ kind: "delete" });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
          then: (resolve: any, reject: any) =>
            Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
        }),
      }),
    }),
  };
  return { db, ops };
}

describe("mediation sessions service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  it("getNextSessionNumber: max+1", async () => {
    const { db } = makeMockDb({ selectRows: [[{ maxN: 2 }]] });
    expect(await getNextSessionNumber(db, "c")).toBe(3);
  });

  it("createSession defaults to scheduled when future date", async () => {
    const { db, ops } = makeMockDb({
      selectRows: [[{ maxN: 0 }]],
      insertReturn: { id: "ms-1", sessionNumber: 1 },
    });
    await createSession(db, {
      orgId: "o",
      caseId: "c",
      mediatorName: "Hon. J. Smith",
      scheduledDate: new Date("2026-06-01T15:00:00.000Z"),
      createdBy: "u",
    });
    const ins = ops.find((o) => o.kind === "insert")!;
    expect(ins.values.status).toBe("scheduled");
    expect(ins.values.outcome).toBe("pending");
    expect(ins.values.sessionType).toBe("initial");
  });

  it("createSession defaults to completed when past date", async () => {
    const { db, ops } = makeMockDb({
      selectRows: [[{ maxN: 0 }]],
      insertReturn: { id: "ms-1", sessionNumber: 1 },
    });
    await createSession(db, {
      orgId: "o",
      caseId: "c",
      mediatorName: "X",
      scheduledDate: new Date("2026-04-01T15:00:00.000Z"),
      createdBy: "u",
    });
    const ins = ops.find((o) => o.kind === "insert")!;
    expect(ins.values.status).toBe("completed");
  });

  it("updateSession on locked (completed) row only writes notes", async () => {
    const { db, ops } = makeMockDb({
      selectRows: [[{ status: "completed" }]],
    });
    await updateSession(db, "ms-1", {
      mediatorName: "Should be ignored",
      notes: "Attended both sides; settled at $50k.",
    });
    const upd = ops.find((o) => o.kind === "update")!;
    expect(upd.set.notes).toContain("settled at $50k");
    expect(upd.set.mediatorName).toBeUndefined();
  });

  it("markStatus + markOutcome are independent transitions", async () => {
    const { db: db1, ops: ops1 } = makeMockDb({
      selectRows: [[{ status: "scheduled" }]],
    });
    await markStatus(db1, "ms-1", "completed");
    expect(ops1.find((o) => o.kind === "update")!.set.status).toBe("completed");

    const { db: db2, ops: ops2 } = makeMockDb({
      selectRows: [[{ status: "completed" }]],
    });
    await markOutcome(db2, "ms-1", "settled");
    expect(ops2.find((o) => o.kind === "update")!.set.outcome).toBe("settled");
  });

  it("deleteSession blocks completed", async () => {
    const { db } = makeMockDb({ selectRows: [[{ status: "completed" }]] });
    await expect(deleteSession(db, "ms-1")).rejects.toThrow(
      /scheduled or cancelled/,
    );
  });

  it("deleteSession allows scheduled and cancelled", async () => {
    for (const s of ["scheduled", "cancelled"]) {
      const { db, ops } = makeMockDb({ selectRows: [[{ status: s }]] });
      await deleteSession(db, "ms-1");
      expect(ops.find((o) => o.kind === "delete")).toBeDefined();
    }
  });
});
