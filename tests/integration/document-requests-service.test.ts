// tests/integration/document-requests-service.test.ts
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { DocumentRequestsService } from "@/server/services/document-requests/service";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  let idCounter = 0;
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        const rows = Array.isArray(v)
          ? v.map((vv) => ({ id: `row-${++idCounter}`, ...(vv as object) }))
          : [{ id: `row-${++idCounter}`, ...(v as object) }];
        return {
          returning: async () => rows,
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, inserts };
}

function makeMockInngest() {
  const events: Array<{ name: string; data: any }> = [];
  const inngest = {
    send: async (e: any) => {
      events.push(e);
    },
  };
  return { inngest, events };
}

describe("DocumentRequestsService.createRequest", () => {
  it("rejects empty items array", async () => {
    const { db } = makeMockDb();
    const { inngest } = makeMockInngest();
    const svc = new DocumentRequestsService({ db, inngest });
    await expect(
      svc.createRequest({
        caseId: "c1",
        title: "Intake",
        items: [],
        createdBy: "u1",
      }),
    ).rejects.toThrow(TRPCError);
    await expect(
      svc.createRequest({
        caseId: "c1",
        title: "Intake",
        items: [],
        createdBy: "u1",
      }),
    ).rejects.toThrow(/At least one item required/);
  });

  it("fires messaging/document_request.created event with correct shape", async () => {
    const { db } = makeMockDb();
    const { inngest, events } = makeMockInngest();
    const svc = new DocumentRequestsService({ db, inngest });
    await svc.createRequest({
      caseId: "c1",
      title: "Intake",
      items: [{ name: "Passport" }],
      createdBy: "u1",
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("messaging/document_request.created");
    expect(events[0].data.caseId).toBe("c1");
    expect(events[0].data.requestId).toBeTruthy();
    expect(events[0].data.createdBy).toBe("u1");
  });

  it("returns requestId", async () => {
    const { db } = makeMockDb();
    const { inngest } = makeMockInngest();
    const svc = new DocumentRequestsService({ db, inngest });
    const result = await svc.createRequest({
      caseId: "c1",
      title: "Intake",
      items: [{ name: "Passport" }, { name: "Proof of address", description: "Utility bill" }],
      createdBy: "u1",
    });
    expect(result).toHaveProperty("requestId");
    expect(typeof result.requestId).toBe("string");
    expect(result.requestId).toBeTruthy();
  });
});
