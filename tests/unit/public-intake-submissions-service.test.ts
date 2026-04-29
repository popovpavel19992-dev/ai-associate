// tests/unit/public-intake-submissions-service.test.ts
import { describe, it, expect } from "vitest";
import { PublicIntakeSubmissionsService } from "@/server/services/public-intake/submissions-service";

type Op = { kind: string; values?: any; set?: any };

function makeDb(opts: {
  selectQueue: any[][];
  insertReturnings?: any[]; // FIFO results for .insert(...).values(...).returning()
}) {
  const queue = [...opts.selectQueue];
  const insertResults = [...(opts.insertReturnings ?? [])];
  const ops: Op[] = [];

  const db: any = {
    select: (_cols?: any) => ({
      from: (_t: any) => {
        const rows = queue.shift() ?? [];
        const chain: any = {
          where: (_w: any) => chain,
          innerJoin: (_t2: any, _on: any) => chain,
          orderBy: (..._x: any[]) => chain,
          limit: (_n: number) => Promise.resolve(rows),
          offset: (_n: number) => Promise.resolve(rows),
          then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
        };
        // Make the chain awaitable directly too.
        return chain;
      },
    }),
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        const r = insertResults.shift() ?? [{ id: "auto-id", ...v }];
        return { returning: () => Promise.resolve(Array.isArray(r) ? r : [r]) };
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
  };
  return { db, ops };
}

const noopInngest = { send: async () => undefined };

describe("PublicIntakeSubmissionsService.recordSubmission", () => {
  it("rejects when required fields are missing", async () => {
    const template = {
      id: "tpl-1",
      orgId: "org-1",
      isActive: true,
      fields: [
        { id: "f1", key: "issue", label: "Issue", type: "text", required: true },
      ],
    };
    const { db } = makeDb({ selectQueue: [[template]] });
    const svc = new PublicIntakeSubmissionsService({ db, inngest: noopInngest });
    await expect(
      svc.recordSubmission({
        templateId: "tpl-1",
        orgId: "org-1",
        answers: {},
      }),
    ).rejects.toThrow(/required fields/i);
  });

  it("inserts with status=new when honeypot is empty", async () => {
    const template = { id: "tpl-1", orgId: "org-1", isActive: true, fields: [], name: "Intake" };
    const { db, ops } = makeDb({
      selectQueue: [[template]],
      insertReturnings: [[{ id: "sub-1" }]],
    });
    const events: any[] = [];
    const svc = new PublicIntakeSubmissionsService({
      db,
      inngest: { send: async (e: any) => events.push(e) },
    });
    const out = await svc.recordSubmission({
      templateId: "tpl-1",
      orgId: "org-1",
      answers: { foo: "bar" },
      submitterName: "Alice",
    });
    expect(out.status).toBe("new");
    expect(out.submissionId).toBe("sub-1");
    const inserted = ops.find((o) => o.kind === "insert");
    expect(inserted?.values.status).toBe("new");
    expect(events[0]?.name).toBe("public-intake/submission.created");
  });

  it("flags submission as spam when honeypot is filled and skips notification", async () => {
    const template = { id: "tpl-1", orgId: "org-1", isActive: true, fields: [], name: "Intake" };
    const { db, ops } = makeDb({
      selectQueue: [[template]],
      insertReturnings: [[{ id: "sub-2" }]],
    });
    const events: any[] = [];
    const svc = new PublicIntakeSubmissionsService({
      db,
      inngest: { send: async (e: any) => events.push(e) },
    });
    const out = await svc.recordSubmission({
      templateId: "tpl-1",
      orgId: "org-1",
      answers: {},
      honeypotValue: "i am a bot",
    });
    expect(out.status).toBe("spam");
    const inserted = ops.find((o) => o.kind === "insert");
    expect(inserted?.values.status).toBe("spam");
    expect(events.length).toBe(0);
  });

  it("rejects if template is not active", async () => {
    const template = { id: "tpl-1", orgId: "org-1", isActive: false, fields: [] };
    const { db } = makeDb({ selectQueue: [[template]] });
    const svc = new PublicIntakeSubmissionsService({ db, inngest: noopInngest });
    await expect(
      svc.recordSubmission({ templateId: "tpl-1", orgId: "org-1", answers: {} }),
    ).rejects.toThrow(/not accepting/i);
  });
});

describe("PublicIntakeSubmissionsService.accept", () => {
  it("creates a client + case and links the submission", async () => {
    const submission = {
      id: "sub-1",
      orgId: "org-1",
      status: "reviewing",
      submitterName: "Jane Doe",
      submitterEmail: "jane@example.com",
      submitterPhone: null,
      createdClientId: null,
      createdCaseId: null,
    };
    const template = { id: "tpl-1", name: "Family Law", caseType: "Family" };

    const { db, ops } = makeDb({
      selectQueue: [
        [{ submission, template }], // getSubmission via inner join
      ],
      insertReturnings: [
        [{ id: "client-1" }], // clients
        [{ id: "case-1" }], // cases
      ],
    });
    const svc = new PublicIntakeSubmissionsService({ db, inngest: noopInngest });
    const out = await svc.accept({ submissionId: "sub-1", orgId: "org-1", userId: "user-1" });
    expect(out.clientId).toBe("client-1");
    expect(out.caseId).toBe("case-1");
    expect(out.alreadyAccepted).toBe(false);

    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values.displayName).toBe("Jane Doe");
    expect(inserts[1].values.overrideCaseType).toBe("Family");

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates[0].set.status).toBe("accepted");
    expect(updates[0].set.createdClientId).toBe("client-1");
    expect(updates[0].set.createdCaseId).toBe("case-1");
  });

  it("returns idempotent result if already accepted", async () => {
    const submission = {
      id: "sub-1",
      orgId: "org-1",
      status: "accepted",
      createdClientId: "client-9",
      createdCaseId: "case-9",
    };
    const template = { id: "tpl-1", name: "X", caseType: null };
    const { db } = makeDb({
      selectQueue: [[{ submission, template }]],
    });
    const svc = new PublicIntakeSubmissionsService({ db, inngest: noopInngest });
    const out = await svc.accept({ submissionId: "sub-1", orgId: "org-1", userId: "user-1" });
    expect(out.alreadyAccepted).toBe(true);
    expect(out.clientId).toBe("client-9");
    expect(out.caseId).toBe("case-9");
  });
});

describe("PublicIntakeSubmissionsService.decline", () => {
  it("flips status to declined and stores reason", async () => {
    const { db, ops } = makeDb({
      selectQueue: [[{ submission: { id: "sub-1", orgId: "org-1" }, template: {} }]],
    });
    const svc = new PublicIntakeSubmissionsService({ db, inngest: noopInngest });
    await svc.decline({
      submissionId: "sub-1",
      orgId: "org-1",
      userId: "user-1",
      reason: "Out of scope",
    });
    const update = ops.find((o) => o.kind === "update");
    expect(update?.set.status).toBe("declined");
    expect(update?.set.declineReason).toBe("Out of scope");
  });
});
