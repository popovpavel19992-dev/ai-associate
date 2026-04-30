// tests/unit/out-of-office-auto-responder.test.ts
//
// Phase 3.14 — auto-responder unit tests.

import { describe, it, expect, vi } from "vitest";
import {
  isEmergency,
  renderTemplate,
  maybeSendAutoResponse,
  DEFAULT_AUTO_RESPONSE_BODY,
} from "@/server/services/out-of-office/auto-responder";

describe("isEmergency", () => {
  it("matches URGENT (case insensitive)", () => {
    expect(isEmergency({ subject: "URGENT: please reply", body: "" })).toBe(true);
    expect(isEmergency({ subject: "Hi", body: "this is urgent" })).toBe(true);
  });
  it("matches EMERGENCY and ASAP", () => {
    expect(isEmergency({ subject: "Emergency", body: "" })).toBe(true);
    expect(isEmergency({ subject: "need this asap", body: "" })).toBe(true);
  });
  it("does not match normal mail", () => {
    expect(isEmergency({ subject: "weekly update", body: "all good" })).toBe(false);
  });
  it("requires word boundary (no false positives on substrings)", () => {
    expect(isEmergency({ subject: "burgent", body: "" })).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("substitutes known merge tags", () => {
    const out = renderTemplate(DEFAULT_AUTO_RESPONSE_BODY, {
      returnDate: "May 10, 2026",
      coverageName: "Jane Doe",
      coverageEmail: "jane@example.com",
      firmPhone: "555-1212",
    });
    expect(out).toContain("May 10, 2026");
    expect(out).toContain("Jane Doe");
    expect(out).toContain("jane@example.com");
    expect(out).toContain("555-1212");
    expect(out).not.toContain("{{return_date}}");
  });
  it("leaves unknown tags untouched", () => {
    const out = renderTemplate("Hello {{nope}}", {
      returnDate: "",
      coverageName: "",
      coverageEmail: "",
      firmPhone: "",
    });
    expect(out).toBe("Hello {{nope}}");
  });
});

// --- maybeSendAutoResponse ----------------------------------------------------

interface FixtureOpts {
  reply?: any;
  outreach?: any;
  parentReply?: any;
  parentOutreach?: any;
  ooo?: any | null;
  coverage?: { name: string; email: string } | null;
  alreadyResponded?: boolean;
  insertThrows?: Error;
}

function makeDb(opts: FixtureOpts) {
  const queue: Array<() => any[]> = [];

  // First select: reply by id
  queue.push(() => (opts.reply ? [opts.reply] : []));
  // Second: outreach by id
  queue.push(() => (opts.outreach ? [opts.outreach] : []));
  // If outreach has parentReplyId, two more selects (parent reply, parent outreach)
  if (opts.outreach?.parentReplyId) {
    queue.push(() => (opts.parentReply ? [opts.parentReply] : []));
    queue.push(() => (opts.parentOutreach ? [opts.parentOutreach] : []));
  }
  // getActiveForUser
  queue.push(() => (opts.ooo ? [opts.ooo] : []));
  // shouldRespondTo dedup check
  queue.push(() => (opts.alreadyResponded ? [{ id: "log-x" }] : []));
  // coverage user lookup (only if ooo has coverageUserId)
  if (opts.ooo?.coverageUserId) {
    queue.push(() => (opts.coverage ? [opts.coverage] : []));
  }

  function makeChain(): any {
    let resolved: any[] | null = null;
    const chain: any = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: any, reject: any) => {
        if (resolved == null) {
          const next = queue.shift();
          resolved = next ? next() : [];
        }
        return Promise.resolve(resolved).then(resolve, reject);
      },
    };
    return chain;
  }

  const inserted: any[] = [];

  const db: any = {
    select: (_cols?: any) => ({ from: (_t: any) => makeChain() }),
    insert: (_t: any) => ({
      values: (v: any) => {
        if (opts.insertThrows) throw opts.insertThrows;
        inserted.push(v);
        return {
          returning: async () => [{ id: "row-1", ...v }],
          then: (resolve: any) => Promise.resolve().then(() => resolve(undefined)),
        };
      },
    }),
  };

  return { db, inserted };
}

describe("maybeSendAutoResponse", () => {
  it("skips when user has no active OOO", async () => {
    const { db } = makeDb({
      reply: {
        id: "rep-1",
        outreachId: "out-1",
        fromEmail: "client@example.com",
        subject: "hello",
        bodyText: "hi",
        messageId: null,
        inReplyTo: null,
        fromName: null,
      },
      outreach: { id: "out-1", sentBy: "u-1", parentReplyId: null },
      ooo: null,
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const out = await maybeSendAutoResponse({ db, sendEmail }, "rep-1");
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("no-active-ooo");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips when already responded to this sender during this period", async () => {
    const { db } = makeDb({
      reply: {
        id: "rep-1",
        outreachId: "out-1",
        fromEmail: "client@example.com",
        subject: "hi",
        bodyText: "",
        messageId: null,
        inReplyTo: null,
        fromName: null,
      },
      outreach: { id: "out-1", sentBy: "u-1", parentReplyId: null },
      ooo: {
        id: "ooo-1",
        endDate: "2026-06-01",
        autoResponseBody: "B",
        autoResponseSubject: "S",
        coverageUserId: null,
        emergencyKeywordResponse: null,
      },
      alreadyResponded: true,
    });
    const sendEmail = vi.fn();
    const out = await maybeSendAutoResponse({ db, sendEmail }, "rep-1");
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("already-responded");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("uses emergency_keyword_response when subject contains URGENT", async () => {
    const { db, inserted } = makeDb({
      reply: {
        id: "rep-1",
        outreachId: "out-1",
        fromEmail: "client@example.com",
        subject: "URGENT problem",
        bodyText: "please respond fast",
        messageId: "<m@x>",
        inReplyTo: null,
        fromName: "Client",
      },
      outreach: { id: "out-1", sentBy: "u-1", parentReplyId: null },
      ooo: {
        id: "ooo-1",
        endDate: "2026-06-01",
        autoResponseBody: "Normal response",
        autoResponseSubject: "OOO",
        coverageUserId: null,
        emergencyKeywordResponse: "EMERGENCY: call coverage at {{coverage_name}}",
      },
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const out = await maybeSendAutoResponse({ db, sendEmail }, "rep-1");
    expect(out.sent).toBe(true);
    expect(out.wasEmergency).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.html).toContain("EMERGENCY");
    expect(inserted[0].wasEmergency).toBe(true);
  });

  it("renders merge tags in normal auto-response body", async () => {
    const { db } = makeDb({
      reply: {
        id: "rep-1",
        outreachId: "out-1",
        fromEmail: "client@example.com",
        subject: "checking in",
        bodyText: "ping",
        messageId: null,
        inReplyTo: null,
        fromName: "Client",
      },
      outreach: { id: "out-1", sentBy: "u-1", parentReplyId: null },
      ooo: {
        id: "ooo-1",
        endDate: "2026-05-15",
        autoResponseBody: "Back on {{return_date}}; coverage {{coverage_name}}.",
        autoResponseSubject: "OOO",
        coverageUserId: "cov-1",
        emergencyKeywordResponse: null,
      },
      coverage: { name: "Jane Doe", email: "jane@firm.com" },
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const out = await maybeSendAutoResponse({ db, sendEmail }, "rep-1");
    expect(out.sent).toBe(true);
    const html = sendEmail.mock.calls[0][0].html as string;
    expect(html).toContain("Jane Doe");
    expect(html).toMatch(/May 15, 2026/);
    expect(html).not.toContain("{{return_date}}");
  });

  it("forwards thread headers when reply has messageId", async () => {
    const { db } = makeDb({
      reply: {
        id: "rep-1",
        outreachId: "out-1",
        fromEmail: "client@example.com",
        subject: "yo",
        bodyText: "",
        messageId: "<abc@mail>",
        inReplyTo: "<root@mail>",
        fromName: null,
      },
      outreach: { id: "out-1", sentBy: "u-1", parentReplyId: null },
      ooo: {
        id: "ooo-1",
        endDate: "2026-06-01",
        autoResponseBody: "B",
        autoResponseSubject: "OOO",
        coverageUserId: null,
        emergencyKeywordResponse: null,
      },
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const out = await maybeSendAutoResponse({ db, sendEmail }, "rep-1");
    expect(out.sent).toBe(true);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.threadHeaders).toBeDefined();
    expect(arg.threadHeaders.inReplyTo).toBe("<abc@mail>");
    expect(arg.threadHeaders.references).toContain("<root@mail>");
    expect(arg.threadHeaders.references).toContain("<abc@mail>");
  });
});
