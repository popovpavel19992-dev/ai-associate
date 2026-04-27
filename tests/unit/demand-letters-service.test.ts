// tests/unit/demand-letters-service.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createLetter,
  getNextLetterNumber,
  updateLetter,
  markSent,
  recordResponse,
  markNoResponse,
  markRescinded,
  deleteLetter,
} from "@/server/services/settlement/demand-letters-service";

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
            opts.insertReturn ?? { id: "row-1", letterNumber: 1 },
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

describe("demand letters service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
  });

  it("getNextLetterNumber: max+1", async () => {
    const { db } = makeMockDb({ selectRows: [[{ maxN: 4 }]] });
    expect(await getNextLetterNumber(db, "c")).toBe(5);
  });

  it("createLetter inserts as draft with auto number", async () => {
    const { db, ops } = makeMockDb({
      selectRows: [[{ maxN: 0 }]],
      insertReturn: { id: "dl-1", letterNumber: 1 },
    });
    await createLetter(db, {
      orgId: "o",
      caseId: "c",
      letterType: "initial_demand",
      recipientName: "Acme Corp.",
      demandAmountCents: 10_000_00,
      createdBy: "u",
    });
    const ins = ops.find((o) => o.kind === "insert")!;
    expect(ins.values.status).toBe("draft");
    expect(ins.values.letterType).toBe("initial_demand");
    expect(ins.values.demandAmountCents).toBe(1000000);
    expect(ins.values.currency).toBe("USD");
  });

  it("updateLetter blocked unless draft", async () => {
    const { db } = makeMockDb({ selectRows: [[{ status: "sent" }]] });
    await expect(
      updateLetter(db, "dl-1", { recipientName: "x" }),
    ).rejects.toThrow(/draft/);
  });

  it("markSent: draft → sent", async () => {
    const { db, ops } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
    await markSent(db, "dl-1", {
      sentAt: new Date("2026-04-25T10:00:00.000Z"),
      sentMethod: "certified_mail",
    });
    const upd = ops.find((o) => o.kind === "update")!;
    expect(upd.set.status).toBe("sent");
    expect(upd.set.sentMethod).toBe("certified_mail");
  });

  it("markSent rejects non-draft", async () => {
    const { db } = makeMockDb({ selectRows: [[{ status: "sent" }]] });
    await expect(
      markSent(db, "dl-1", {
        sentAt: new Date(),
        sentMethod: "email",
      }),
    ).rejects.toThrow(/draft/);
  });

  it("recordResponse: sent → responded", async () => {
    const { db, ops } = makeMockDb({ selectRows: [[{ status: "sent" }]] });
    await recordResponse(db, "dl-1", {
      responseReceivedAt: new Date(),
      responseSummary: "Counsel offered $25k.",
    });
    const upd = ops.find((o) => o.kind === "update")!;
    expect(upd.set.status).toBe("responded");
    expect(upd.set.responseSummary).toContain("$25k");
  });

  it("recordResponse rejects non-sent", async () => {
    const { db } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
    await expect(
      recordResponse(db, "dl-1", { responseReceivedAt: new Date() }),
    ).rejects.toThrow(/sent/);
  });

  it("markNoResponse and markRescinded require sent", async () => {
    const { db: db1, ops: ops1 } = makeMockDb({
      selectRows: [[{ status: "sent" }]],
    });
    await markNoResponse(db1, "dl-1");
    expect(ops1.find((o) => o.kind === "update")!.set.status).toBe(
      "no_response",
    );

    const { db: db2, ops: ops2 } = makeMockDb({
      selectRows: [[{ status: "sent" }]],
    });
    await markRescinded(db2, "dl-1");
    expect(ops2.find((o) => o.kind === "update")!.set.status).toBe("rescinded");

    const { db: db3 } = makeMockDb({ selectRows: [[{ status: "draft" }]] });
    await expect(markNoResponse(db3, "dl-1")).rejects.toThrow(/sent/);
  });

  it("deleteLetter only when draft", async () => {
    const { db: dbDraft, ops } = makeMockDb({
      selectRows: [[{ status: "draft" }]],
    });
    await deleteLetter(dbDraft, "dl-1");
    expect(ops.find((o) => o.kind === "delete")).toBeDefined();

    for (const s of ["sent", "responded", "no_response", "rescinded"]) {
      const { db } = makeMockDb({ selectRows: [[{ status: s }]] });
      await expect(deleteLetter(db, "dl-1")).rejects.toThrow(/draft/);
    }
  });
});
