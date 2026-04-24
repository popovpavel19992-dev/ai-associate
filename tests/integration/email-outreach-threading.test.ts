// tests/integration/email-outreach-threading.test.ts
// 2.3.5d: outbound reply threading — verifies In-Reply-To / References headers
// and scope checks for parentReplyId.
import { describe, it, expect } from "vitest";
import { EmailOutreachService } from "@/server/services/email-outreach/service";
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailOutreachAttachments } from "@/server/db/schema/case-email-outreach-attachments";
import { cases } from "@/server/db/schema/cases";
import { clients } from "@/server/db/schema/clients";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { portalUsers } from "@/server/db/schema/portal-users";
import { documents } from "@/server/db/schema/documents";

/**
 * Table-aware mock db: selects return a pre-registered row set per table.
 * Inserts are captured in `inserts` and return a single synthesized row from the values.
 */
function makeDb(rowsByTable: Map<unknown, unknown[]>) {
  const inserts: Array<{ table: unknown; values: any }> = [];
  let idCounter = 0;
  const nextId = () => `row-${++idCounter}`;

  const makeSelectChain = (fromTable: unknown) => {
    const rows = rowsByTable.get(fromTable) ?? [];
    const result: any = Promise.resolve(rows);
    result.where = () => result;
    result.limit = () => Promise.resolve(rows);
    result.orderBy = () => Promise.resolve(rows);
    // where chain → .limit / .orderBy
    const whereChain: any = {
      limit: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
      then: (resolve: any) => Promise.resolve(rows).then(resolve),
    };
    return {
      where: () => whereChain,
      orderBy: () => Promise.resolve(rows),
      then: (resolve: any) => Promise.resolve(rows).then(resolve),
    };
  };

  const db: any = {
    select: () => ({
      from: (t: unknown) => makeSelectChain(t),
    }),
    insert: (t: unknown) => ({
      values: (v: any) => {
        inserts.push({ table: t, values: v });
        const row = Array.isArray(v) ? v : { id: v?.id ?? nextId(), ...v };
        return {
          returning: async () => [Array.isArray(row) ? row[0] : row],
          then: (resolve: any) => resolve(undefined),
        };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return { db, inserts };
}

function baseFixtures(opts: { caseId: string; parentReply?: any }) {
  const rows = new Map<unknown, unknown[]>();
  rows.set(cases, [{ id: opts.caseId, name: "Test v. Case", clientId: "client-1", orgId: "org-1" }]);
  rows.set(clients, [{ displayName: "Acme Corp", firstName: "Acme" }]);
  rows.set(users, [{ name: "Lawyer Bob", email: "bob@firm.test" }]);
  rows.set(organizations, [{ name: "Firm LLP" }]);
  rows.set(clientContacts, [{ email: "client@example.test", name: "Client", isPrimary: true }]);
  rows.set(portalUsers, []);
  rows.set(documents, []);
  rows.set(caseEmailReplies, opts.parentReply ? [opts.parentReply] : []);
  rows.set(caseEmailOutreach, []);
  rows.set(caseEmailOutreachAttachments, []);
  return rows;
}

describe("EmailOutreachService.send — reply threading", () => {
  it("sets In-Reply-To + References headers when parentReplyId supplied", async () => {
    const caseId = "11111111-1111-1111-1111-111111111111";
    const replyId = "22222222-2222-2222-2222-222222222222";
    const parentReply = {
      id: replyId,
      caseId,
      messageId: "<reply-msg-id@mail.test>",
      inReplyTo: "<original-outbound@clearterms.ai>",
    };
    const rows = baseFixtures({ caseId, parentReply });
    const { db, inserts } = makeDb(rows);

    const sent: any[] = [];
    const svc = new EmailOutreachService({
      db,
      resendSend: async (opts) => {
        sent.push(opts);
        return { id: "resend-123" };
      },
    });

    const res = await svc.send({
      caseId,
      subject: "Re: ping",
      bodyMarkdown: "thanks",
      documentIds: [],
      senderId: "user-1",
      parentReplyId: replyId,
    });

    expect(res.emailId).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0].threadHeaders).toEqual({
      inReplyTo: "<reply-msg-id@mail.test>",
      references: ["<original-outbound@clearterms.ai>", "<reply-msg-id@mail.test>"],
    });

    const outreachInsert = inserts.find((i) => i.table === caseEmailOutreach);
    expect(outreachInsert).toBeDefined();
    expect(outreachInsert!.values.parentReplyId).toBe(replyId);
    expect(outreachInsert!.values.inReplyTo).toBe("<reply-msg-id@mail.test>");
  });

  it("rejects parentReplyId belonging to another case with BAD_REQUEST", async () => {
    const caseId = "11111111-1111-1111-1111-111111111111";
    const otherCaseId = "99999999-9999-9999-9999-999999999999";
    const replyId = "22222222-2222-2222-2222-222222222222";
    const parentReply = {
      id: replyId,
      caseId: otherCaseId,
      messageId: "<x@mail.test>",
      inReplyTo: null,
    };
    const rows = baseFixtures({ caseId, parentReply });
    const { db } = makeDb(rows);
    const svc = new EmailOutreachService({
      db,
      resendSend: async () => ({ id: "x" }),
    });

    await expect(
      svc.send({
        caseId,
        subject: "x",
        bodyMarkdown: "x",
        documentIds: [],
        senderId: "user-1",
        parentReplyId: replyId,
      }),
    ).rejects.toThrow(/Parent reply not found/);
  });

  it("preserves legacy behavior when parentReplyId is absent (no threadHeaders)", async () => {
    const caseId = "11111111-1111-1111-1111-111111111111";
    const rows = baseFixtures({ caseId });
    const { db, inserts } = makeDb(rows);

    const sent: any[] = [];
    const svc = new EmailOutreachService({
      db,
      resendSend: async (opts) => {
        sent.push(opts);
        return { id: "r1" };
      },
    });

    await svc.send({
      caseId,
      subject: "hello",
      bodyMarkdown: "first contact",
      documentIds: [],
      senderId: "user-1",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].threadHeaders).toBeUndefined();
    const outreachInsert = inserts.find((i) => i.table === caseEmailOutreach);
    expect(outreachInsert!.values.parentReplyId).toBeNull();
    expect(outreachInsert!.values.inReplyTo).toBeNull();
  });
});
