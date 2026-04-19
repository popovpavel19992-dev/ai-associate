// tests/integration/case-messages-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { CaseMessagesService } from "@/server/services/messaging/case-messages-service";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const selectQueue: unknown[][] = [];
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return {
          returning: async () => [{ id: "msg-1", ...(v as object) }],
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: "read-1", ...(v as object) }],
          }),
        };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => {
        updates.push({ table: t, set: s });
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
    inserts,
    updates,
  } as any;
  return db;
}

describe("CaseMessagesService.send", () => {
  it("inserts lawyer message with documentId when provided", async () => {
    const db = makeMockDb();
    db.enqueue([{ id: "doc-1", caseId: "case-1" }]); // attachment validation
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    const result = await svc.send({
      caseId: "case-1",
      lawyerUserId: "u1",
      body: "hello",
      documentId: "doc-1",
    });
    expect(result.messageId).toBe("msg-1");
    const msgInsert = db.inserts.find((i: any) => (i.values as any).body === "hello");
    expect(msgInsert).toBeDefined();
    expect((msgInsert!.values as any).documentId).toBe("doc-1");
    expect((msgInsert!.values as any).authorType).toBe("lawyer");
  });

  it("rejects documentId belonging to different case", async () => {
    const db = makeMockDb();
    db.enqueue([{ id: "doc-1", caseId: "OTHER-CASE" }]);
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    await expect(
      svc.send({ caseId: "case-1", lawyerUserId: "u1", body: "x", documentId: "doc-1" }),
    ).rejects.toThrow(/not in this case/i);
  });

  it("dispatches Inngest event after insert", async () => {
    const db = makeMockDb();
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    await svc.send({ caseId: "case-1", lawyerUserId: "u1", body: "hi" });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "messaging/case_message.created" }),
    );
  });
});

describe("CaseMessagesService.markRead", () => {
  it("UPSERTs read row", async () => {
    const db = makeMockDb();
    const inngest = { send: vi.fn() };
    const svc = new CaseMessagesService({ db, inngest });
    await svc.markRead({ caseId: "case-1", userId: "u1" });
    const upsert = db.inserts.find((i: any) => (i.values as any).caseId === "case-1");
    expect(upsert).toBeDefined();
    expect((upsert!.values as any).userId).toBe("u1");
  });
});
