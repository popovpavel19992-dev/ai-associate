// tests/unit/document-templates-service.test.ts
//
// Phase 3.12 — service-layer unit tests using a hand-rolled mock db,
// matching the style of discovery-service.test.ts.

import { describe, it, expect } from "vitest";
import * as svc from "@/server/services/document-templates/service";

type Op = { kind: string; values?: any; set?: any };

interface MockOpts {
  selectQueue: any[][];
  insertReturnRows?: any[];
}

function makeMockDb(opts: MockOpts) {
  const ops: Op[] = [];
  const selectQueue = [...opts.selectQueue];
  const insertRows = [...(opts.insertReturnRows ?? [])];

  const db: any = {
    select: (_cols?: any) => ({
      from: (_t: any) => ({
        where: (_w: any) => {
          const result = selectQueue.shift() ?? [];
          const queryable: any = {
            limit: async (_n: number) => result,
            orderBy: async (..._args: any[]) => result,
            then: (resolve: any) => resolve(result),
          };
          return queryable;
        },
      }),
    }),
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        return {
          returning: async () => [insertRows.shift() ?? { id: "new-id", ...v }],
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
  };
  return { db, ops };
}

describe("3.12 service — getTemplate", () => {
  it("throws NOT_FOUND when nothing matches", async () => {
    const { db } = makeMockDb({ selectQueue: [[]] });
    await expect(svc.getTemplate(db, "missing-id")).rejects.toThrow(/not found/i);
  });

  it("returns the row when found", async () => {
    const row = { id: "t1", name: "X", category: "retainer", orgId: null };
    const { db } = makeMockDb({ selectQueue: [[row]] });
    const got = await svc.getTemplate(db, "t1");
    expect(got).toEqual(row);
  });
});

describe("3.12 service — updateTemplate", () => {
  it("rejects edits to a global library template", async () => {
    const row = { id: "t1", orgId: null, name: "Global", category: "retainer" };
    const { db } = makeMockDb({ selectQueue: [[row]] });
    await expect(
      svc.updateTemplate(db, { templateId: "t1", orgId: "org-1", patch: { name: "Hacked" } }),
    ).rejects.toThrow(/global library/i);
  });

  it("rejects edits to another org's template", async () => {
    const row = { id: "t1", orgId: "other-org", name: "X", category: "retainer" };
    const { db } = makeMockDb({ selectQueue: [[row]] });
    await expect(
      svc.updateTemplate(db, { templateId: "t1", orgId: "org-1", patch: { name: "Hacked" } }),
    ).rejects.toThrow(/another organization/i);
  });
});

describe("3.12 service — deleteTemplate", () => {
  it("blocks deletion when generated docs reference it", async () => {
    const row = { id: "t1", orgId: "org-1", name: "X", category: "retainer" };
    const { db } = makeMockDb({ selectQueue: [[row], [{ count: 3 }]] });
    await expect(
      svc.deleteTemplate(db, { templateId: "t1", orgId: "org-1" }),
    ).rejects.toThrow(/referenced by generated documents/i);
  });

  it("deletes when no generated docs reference it", async () => {
    const row = { id: "t1", orgId: "org-1", name: "X", category: "retainer" };
    const { db, ops } = makeMockDb({ selectQueue: [[row], [{ count: 0 }]] });
    const out = await svc.deleteTemplate(db, { templateId: "t1", orgId: "org-1" });
    expect(out.ok).toBe(true);
    expect(ops.some((o) => o.kind === "delete")).toBe(true);
  });
});

describe("3.12 service — generateFromTemplate", () => {
  it("renders the body, persists a draft, and returns the row", async () => {
    const tpl = {
      id: "tpl-1",
      orgId: null,
      category: "retainer",
      name: "Retainer",
      body: "Hi {{client.name}}, retainer is {{fee.amount}}.",
      variables: [
        { key: "client.name", label: "Client", type: "text", required: true },
        { key: "fee.amount", label: "Fee", type: "currency", required: true },
      ],
      isActive: true,
    };
    const insertedRow = { id: "doc-1", body: "", title: "Retainer", status: "draft" };
    const { db, ops } = makeMockDb({
      selectQueue: [[tpl]],
      insertReturnRows: [insertedRow],
    });

    const out = await svc.generateFromTemplate(db, {
      orgId: "org-1",
      templateId: "tpl-1",
      caseId: "case-1",
      variableValues: { "client.name": "Acme", "fee.amount": "500000" },
      createdBy: "user-1",
    });

    expect(out).toEqual(insertedRow);
    const insertOp = ops.find((o) => o.kind === "insert");
    expect(insertOp).toBeTruthy();
    expect(insertOp!.values.body).toBe("Hi Acme, retainer is $5,000.00.");
    expect(insertOp!.values.status).toBe("draft");
    expect(insertOp!.values.title).toBe("Retainer");
    expect(insertOp!.values.variablesFilled).toEqual({ "client.name": "Acme", "fee.amount": "500000" });
  });

  it("requires either caseId or clientId", async () => {
    const { db } = makeMockDb({ selectQueue: [] });
    await expect(
      svc.generateFromTemplate(db, {
        orgId: "org-1",
        templateId: "tpl-1",
        variableValues: {},
        createdBy: "user-1",
      }),
    ).rejects.toThrow(/caseId or clientId is required/);
  });

  it("rejects an org template that belongs to a different org", async () => {
    const tpl = {
      id: "tpl-1", orgId: "other-org", category: "retainer", name: "X",
      body: "x", variables: [], isActive: true,
    };
    const { db } = makeMockDb({ selectQueue: [[tpl]] });
    await expect(
      svc.generateFromTemplate(db, {
        orgId: "org-1",
        templateId: "tpl-1",
        caseId: "case-1",
        variableValues: {},
        createdBy: "user-1",
      }),
    ).rejects.toThrow(/not available to this organization/);
  });
});

describe("3.12 service — finalize / markSent / supersede transitions", () => {
  it("finalize: draft → finalized (sets finalizedAt)", async () => {
    const draft = { id: "d1", orgId: "org-1", status: "draft" };
    const finalized = { ...draft, status: "finalized", finalizedAt: new Date() };
    const { db, ops } = makeMockDb({ selectQueue: [[draft], [finalized]] });
    const out = await svc.finalizeGeneratedDoc(db, { orgId: "org-1", docId: "d1" });
    expect(out.status).toBe("finalized");
    const updateOp = ops.find((o) => o.kind === "update");
    expect(updateOp!.set.status).toBe("finalized");
    expect(updateOp!.set.finalizedAt).toBeInstanceOf(Date);
  });

  it("finalize: refuses superseded", async () => {
    const doc = { id: "d1", orgId: "org-1", status: "superseded" };
    const { db } = makeMockDb({ selectQueue: [[doc]] });
    await expect(
      svc.finalizeGeneratedDoc(db, { orgId: "org-1", docId: "d1" }),
    ).rejects.toThrow(/superseded/);
  });

  it("markSent: refuses to advance from draft", async () => {
    const doc = { id: "d1", orgId: "org-1", status: "draft" };
    const { db } = makeMockDb({ selectQueue: [[doc]] });
    await expect(
      svc.markSent(db, { orgId: "org-1", docId: "d1" }),
    ).rejects.toThrow(/finalize/i);
  });

  it("markSent: finalized → sent", async () => {
    const doc = { id: "d1", orgId: "org-1", status: "finalized" };
    const sent = { ...doc, status: "sent", sentAt: new Date() };
    const { db, ops } = makeMockDb({ selectQueue: [[doc], [sent]] });
    const out = await svc.markSent(db, { orgId: "org-1", docId: "d1" });
    expect(out.status).toBe("sent");
    const updateOp = ops.find((o) => o.kind === "update");
    expect(updateOp!.set.status).toBe("sent");
  });

  it("supersede: any → superseded", async () => {
    const doc = { id: "d1", orgId: "org-1", status: "finalized" };
    const sup = { ...doc, status: "superseded" };
    const { db, ops } = makeMockDb({ selectQueue: [[doc], [sup]] });
    const out = await svc.supersedeGeneratedDoc(db, { orgId: "org-1", docId: "d1" });
    expect(out.status).toBe("superseded");
    const updateOp = ops.find((o) => o.kind === "update");
    expect(updateOp!.set.status).toBe("superseded");
  });

  it("update: refuses to mutate a finalized document body", async () => {
    const doc = { id: "d1", orgId: "org-1", status: "finalized" };
    const { db } = makeMockDb({ selectQueue: [[doc]] });
    await expect(
      svc.updateGeneratedDoc(db, { orgId: "org-1", docId: "d1", patch: { body: "tampered" } }),
    ).rejects.toThrow(/Cannot edit a finalized/);
  });

  it("update: forbids cross-org access", async () => {
    const doc = { id: "d1", orgId: "other", status: "draft" };
    const { db } = makeMockDb({ selectQueue: [[doc]] });
    await expect(
      svc.updateGeneratedDoc(db, { orgId: "org-1", docId: "d1", patch: { title: "X" } }),
    ).rejects.toThrow(/not in your org/);
  });
});
