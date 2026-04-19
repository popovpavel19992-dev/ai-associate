// tests/integration/collections-service.test.ts
import { describe, it, expect } from "vitest";
import { CollectionsService } from "@/server/services/research/collections";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const deletes: Array<{ table: unknown }> = [];
  const selectQueue: unknown[][] = [];
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return {
          onConflictDoNothing: () => ({ returning: async () => [{ id: "i1", ...(v as object) }] }),
          returning: async () => [{ id: "i1", ...(v as object) }],
        };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => {
        updates.push({ table: t, set: s });
        return { where: () => ({ returning: async () => [{ id: "u1", ...(s as object) }] }) };
      },
    }),
    delete: (t: unknown) => ({
      where: () => {
        deletes.push({ table: t });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
  } as any;
  return { db, inserts, updates, deletes };
}

describe("CollectionsService.addItem", () => {
  it("inserts opinion item with correct polymorphic FK", async () => {
    const { db, inserts } = makeMockDb();
    db.enqueue([]); // existing-item check returns empty
    const svc = new CollectionsService({ db });
    const result = await svc.addItem({
      collectionId: "c1",
      addedBy: "u1",
      item: { type: "opinion", id: "op1" },
    });
    expect(result.itemId).toBeTruthy();
    const itemInsert = inserts.find((i) => (i.values as any).itemType === "opinion");
    expect(itemInsert).toBeDefined();
    const v = itemInsert!.values as any;
    expect(v.opinionId).toBe("op1");
    expect(v.statuteId).toBeNull();
    expect(v.memoId).toBeNull();
    expect(v.sessionId).toBeNull();
  });

  it("idempotent: returns existing id when item already in collection", async () => {
    const { db, inserts } = makeMockDb();
    db.enqueue([{ id: "existing-item-id", collectionId: "c1", itemType: "opinion", opinionId: "op1" }]);
    const svc = new CollectionsService({ db });
    const result = await svc.addItem({
      collectionId: "c1",
      addedBy: "u1",
      item: { type: "opinion", id: "op1" },
    });
    expect(result.itemId).toBe("existing-item-id");
    expect(inserts).toHaveLength(0);
  });
});

describe("CollectionsService.normalizeTags (smoke)", () => {
  it("lowercases, trims, dedups", () => {
    const out = CollectionsService.normalizeTags(["Damages", "  damages ", "FAA", "faa"]);
    expect(out.sort()).toEqual(["damages", "faa"]);
  });
  it("rejects empty + over-long", () => {
    const out = CollectionsService.normalizeTags(["", "a".repeat(60), "ok"]);
    expect(out).toEqual(["ok"]);
  });
});

describe("CollectionsService.reorder", () => {
  it("updates each item's position via tx", async () => {
    const { db, updates } = makeMockDb();
    const svc = new CollectionsService({ db });
    await svc.reorder({ collectionId: "c1", itemIds: ["a", "b", "c"] });
    // 3 item position updates + 1 touchParent updatedAt update = 4
    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect((updates[0].set as any).position).toBe(0);
    expect((updates[1].set as any).position).toBe(1);
    expect((updates[2].set as any).position).toBe(2);
  });
});
