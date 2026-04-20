// tests/integration/intake-forms-service.test.ts
import { describe, it, expect } from "vitest";
import { IntakeFormsService } from "@/server/services/intake-forms/service";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const selectQueue: unknown[][] = [];
  let idCounter = 0;
  const nextId = () => `row-${++idCounter}`;
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        const rows = Array.isArray(v)
          ? (v as Array<Record<string, unknown>>).map((r) => ({ id: nextId(), ...r }))
          : [{ id: nextId(), ...(v as Record<string, unknown>) }];
        return { returning: async () => rows };
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
          limit: async () => selectQueue.shift() ?? [],
          orderBy: () => ({ limit: async () => selectQueue.shift() ?? [] }),
        }),
        orderBy: () => ({ limit: async () => selectQueue.shift() ?? [] }),
        leftJoin: () => ({
          where: async () => selectQueue.shift() ?? [],
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
  } as any;
  return { db, inserts, updates };
}

describe("IntakeFormsService.createDraft", () => {
  it("inserts a form with empty schema in 'draft' status", async () => {
    const { db, inserts } = makeMockDb();
    const svc = new IntakeFormsService({ db, inngest: { send: async () => {} } });
    const res = await svc.createDraft({
      caseId: "c1",
      title: "Intake",
      description: "Please fill",
      createdBy: "u1",
    });
    expect(res.formId).toBeTruthy();
    const values = inserts[0]?.values as Record<string, unknown>;
    expect(values.status).toBe("draft");
    expect(values.title).toBe("Intake");
    expect(values.schema).toEqual({ fields: [] });
  });
});

describe("IntakeFormsService.updateDraft", () => {
  it("rejects edits when status is not draft", async () => {
    const { db } = makeMockDb();
    db.enqueue([{ status: "sent" }]);
    const svc = new IntakeFormsService({ db, inngest: { send: async () => {} } });
    await expect(
      svc.updateDraft({ formId: "f1", title: "New" }),
    ).rejects.toThrow(/only be edited while in draft/);
  });

  it("accepts a valid schema on a draft form", async () => {
    const { db, updates } = makeMockDb();
    db.enqueue([{ status: "draft" }]);
    const svc = new IntakeFormsService({ db, inngest: { send: async () => {} } });
    await svc.updateDraft({
      formId: "f1",
      schema: {
        fields: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            type: "short_text",
            label: "Full name",
            required: true,
          },
        ],
      },
    });
    const set = updates[0]?.set as Record<string, unknown>;
    expect(set.schema).toBeDefined();
  });
});
