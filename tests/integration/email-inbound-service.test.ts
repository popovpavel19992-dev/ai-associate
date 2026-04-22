import { describe, it, expect } from "vitest";
import { EmailInboundService, buildReplyToAddress, parseOutreachIdFromTo } from "@/server/services/email-outreach/inbound";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";

function makeMockDb(opts: {
  existingReplyForEventId?: string;
  existingOutreach?: { id: string; caseId: string; sentBy: string; recipientEmail: string; subject: string } | null;
  prefsEnabled?: boolean;
}) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown; where: unknown }> = [];
  // Track select calls in order: event-id lookup, outreach lookup, prefs lookup
  let selectCallCount = 0;
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return Promise.resolve();
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => ({
        where: (w: unknown) => {
          updates.push({ table: t, set: s, where: w });
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCallCount++;
            if (selectCallCount === 1) {
              return opts.existingReplyForEventId ? [{ id: "existing-reply-id" }] : [];
            }
            if (selectCallCount === 2) {
              return opts.existingOutreach ? [opts.existingOutreach] : [];
            }
            if (selectCallCount === 3) {
              return opts.prefsEnabled ? [{ enabled: true }] : [];
            }
            return [];
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

const OUTREACH_ID = "11111111-1111-1111-1111-111111111111";
const CASE_ID = "22222222-2222-2222-2222-222222222222";
const LAWYER_ID = "33333333-3333-3333-3333-333333333333";
const BASE_OUTREACH = {
  id: OUTREACH_ID,
  caseId: CASE_ID,
  sentBy: LAWYER_ID,
  recipientEmail: "jane@client.com",
  subject: "Your case update",
};

const BASE_PAYLOAD = {
  eventId: "evt_1",
  to: [buildReplyToAddress(OUTREACH_ID)],
  from: { email: "jane@client.com", name: "Jane Client" },
  subject: "Re: Your case update",
  text: "Thanks, John. Got it.",
  html: "<p>Thanks, John. Got it.</p>",
  headers: {} as Record<string, string | undefined>,
  receivedAt: new Date("2026-04-21T12:00:00Z"),
};

describe("buildReplyToAddress / parseOutreachIdFromTo", () => {
  it("round-trips", () => {
    const addr = buildReplyToAddress(OUTREACH_ID);
    expect(parseOutreachIdFromTo([addr])).toBe(OUTREACH_ID);
  });
  it("rejects non-matching addresses", () => {
    expect(parseOutreachIdFromTo(["random@example.com"])).toBeNull();
  });
});

describe("EmailInboundService.ingest", () => {
  it("idempotent on duplicate event id", async () => {
    const { db } = makeMockDb({ existingReplyForEventId: "evt_1" });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest(BASE_PAYLOAD);
    expect(res.status).toBe("duplicate");
  });

  it("unrouted when To doesn't match", async () => {
    const { db } = makeMockDb({});
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest({ ...BASE_PAYLOAD, to: ["who@somewhere.com"] });
    expect(res.status).toBe("unrouted");
  });

  it("no-parent when outreach id unknown", async () => {
    const { db } = makeMockDb({ existingOutreach: null });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest(BASE_PAYLOAD);
    expect(res.status).toBe("no-parent");
  });

  it("bounce → updates outreach status, no reply row", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest({
      ...BASE_PAYLOAD,
      from: { email: "mailer-daemon@example.com" },
      subject: "Mail Delivery Failure",
    });
    expect(res.status).toBe("bounced");
    const replyInserts = inserts.filter((i) => {
      const v = i.values as Record<string, unknown>;
      return v && "replyKind" in v;
    });
    expect(replyInserts.length).toBe(0);
    const outreachUpdates = updates.filter((u) => u.table === caseEmailOutreach);
    expect(outreachUpdates.length).toBe(1);
    expect((outreachUpdates[0].set as Record<string, unknown>).status).toBe("bounced");
  });

  it("inserts human reply + notification", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    const res = await svc.ingest(BASE_PAYLOAD);
    expect(res.status).toBe("ok");
    expect(res.replyId).toBeTruthy();
    const replyInserts = inserts.filter((i) => {
      const v = i.values as Record<string, unknown>;
      return v && "replyKind" in v;
    });
    expect(replyInserts.length).toBe(1);
    expect((replyInserts[0].values as Record<string, unknown>).replyKind).toBe("human");
    expect((replyInserts[0].values as Record<string, unknown>).senderMismatch).toBe(false);
  });

  it("flags sender_mismatch when From differs from recipient", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    await svc.ingest({ ...BASE_PAYLOAD, from: { email: "assistant@otherdomain.com" } });
    const replyValues = (inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return v && "replyKind" in v;
    })!.values) as Record<string, unknown>;
    expect(replyValues.senderMismatch).toBe(true);
  });

  it("classifies Out of Office as auto_reply", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    await svc.ingest({ ...BASE_PAYLOAD, subject: "Out of Office: back on Monday" });
    const replyValues = (inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return v && "replyKind" in v;
    })!.values) as Record<string, unknown>;
    expect(replyValues.replyKind).toBe("auto_reply");
  });

  it("sanitizes <script> from body_html", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const svc = new EmailInboundService({ db });
    await svc.ingest({
      ...BASE_PAYLOAD,
      html: "<p>hi</p><script>alert(1)</script>",
    });
    const replyValues = (inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return v && "replyKind" in v;
    })!.values) as Record<string, unknown>;
    expect(replyValues.bodyHtml).not.toContain("<script>");
    expect(replyValues.bodyHtml).toContain("hi");
  });

  it("skips inline signature image (small + contentId)", async () => {
    const { db, inserts } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const putCalls: string[] = [];
    const svc = new EmailInboundService({
      db,
      putObject: async (k) => { putCalls.push(k); },
    });
    await svc.ingest({
      ...BASE_PAYLOAD,
      attachments: [
        { filename: "sig.png", contentType: "image/png", size: 2048, content: Buffer.from("x"), contentId: "sig@x" },
      ],
    });
    expect(putCalls.length).toBe(0);
    const attachInserts = inserts.filter((i) => {
      const v = i.values;
      return Array.isArray(v);
    });
    expect(attachInserts.length).toBe(0);
  });

  it("truncates attachments over 25MB budget", async () => {
    const { db } = makeMockDb({ existingOutreach: BASE_OUTREACH });
    const putCalls: string[] = [];
    const svc = new EmailInboundService({
      db,
      putObject: async (k) => { putCalls.push(k); },
    });
    const big = Buffer.alloc(20 * 1024 * 1024);
    await svc.ingest({
      ...BASE_PAYLOAD,
      attachments: [
        { filename: "a.pdf", contentType: "application/pdf", size: 20 * 1024 * 1024, content: big },
        { filename: "b.pdf", contentType: "application/pdf", size: 20 * 1024 * 1024, content: big },
      ],
    });
    expect(putCalls.length).toBe(1);
    expect(putCalls[0]).toContain("a.pdf");
  });
});
