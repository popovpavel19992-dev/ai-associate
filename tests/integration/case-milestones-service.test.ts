// tests/integration/case-milestones-service.test.ts
import { describe, it, expect } from "vitest";
import { CaseMilestonesService } from "@/server/services/case-milestones/service";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const deletes: Array<{ table: unknown }> = [];
  const selectQueue: unknown[][] = [];
  let idCounter = 0;
  const nextId = () => `row-${++idCounter}`;
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        const row = { id: nextId(), ...(v as Record<string, unknown>) };
        return { returning: async () => [row] };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => {
        updates.push({ table: t, set: s });
        return { where: () => Promise.resolve() };
      },
    }),
    delete: (t: unknown) => ({
      where: () => { deletes.push({ table: t }); return Promise.resolve(); },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
        orderBy: () => ({ limit: async () => selectQueue.shift() ?? [] }),
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ limit: async () => selectQueue.shift() ?? [] }),
          }),
        }),
      }),
    }),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
  } as any;
  return { db, inserts, updates, deletes };
}

describe("CaseMilestonesService.createDraft", () => {
  it("inserts milestone with status='draft' and trimmed title", async () => {
    const { db, inserts } = makeMockDb();
    const svc = new CaseMilestonesService({ db, inngest: { send: async () => {} } });
    const res = await svc.createDraft({
      caseId: "c1",
      title: "  Filed complaint  ",
      category: "filing",
      occurredAt: new Date("2026-04-18"),
      createdBy: "u1",
    });
    expect(res.milestoneId).toBeTruthy();
    const values = inserts[0]?.values as Record<string, unknown>;
    expect(values.status).toBe("draft");
    expect(values.title).toBe("Filed complaint");
    expect(values.category).toBe("filing");
  });

  it("rejects invalid category", async () => {
    const { db } = makeMockDb();
    const svc = new CaseMilestonesService({ db, inngest: { send: async () => {} } });
    await expect(
      svc.createDraft({
        caseId: "c1",
        title: "X",
        category: "not_a_category",
        occurredAt: new Date(),
        createdBy: "u1",
      }),
    ).rejects.toThrow(/Invalid category/);
  });
});

describe("CaseMilestonesService.publish", () => {
  it("transitions draft → published and fires event", async () => {
    const { db, updates } = makeMockDb();
    db.enqueue([{ id: "m1", caseId: "c1", status: "draft", title: "X" }]);
    const events: any[] = [];
    const svc = new CaseMilestonesService({ db, inngest: { send: async (e) => events.push(e) } });
    await svc.publish({ milestoneId: "m1" });
    const set = updates[0]?.set as Record<string, unknown>;
    expect(set.status).toBe("published");
    expect(events.find((e) => e.name === "messaging/milestone.published")).toBeTruthy();
  });

  it("rejects publish on non-draft", async () => {
    const { db } = makeMockDb();
    db.enqueue([{ id: "m1", caseId: "c1", status: "published", title: "X" }]);
    const svc = new CaseMilestonesService({ db, inngest: { send: async () => {} } });
    await expect(svc.publish({ milestoneId: "m1" })).rejects.toThrow(/Only draft milestones/);
  });
});

describe("CaseMilestonesService.retract", () => {
  it("fires retracted event", async () => {
    const { db } = makeMockDb();
    db.enqueue([{ caseId: "c1", status: "published", title: "X" }]);
    const events: any[] = [];
    const svc = new CaseMilestonesService({ db, inngest: { send: async (e) => events.push(e) } });
    await svc.retract({ milestoneId: "m1", retractedBy: "u1", reason: "typo" });
    expect(events.find((e) => e.name === "messaging/milestone.retracted")).toBeTruthy();
  });
});
