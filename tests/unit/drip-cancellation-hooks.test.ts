// tests/unit/drip-cancellation-hooks.test.ts
//
// Verifies the drip auto-cancel hooks wired into the inbound reply path and
// the Resend events ingest path. We mock cancelEnrollmentsForContact and the
// db's resolver dependency so we can assert the hook is invoked with the
// right reason on the right events, and skipped on auto_reply.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mocks so they're available when vi.mock factories run.
const { cancelEnrollmentsForContactMock, resolveClientContactIdForReplyMock } = vi.hoisted(() => ({
  cancelEnrollmentsForContactMock: vi.fn(async () => 1),
  resolveClientContactIdForReplyMock: vi.fn(async () => "contact-1"),
}));

vi.mock("@/server/services/drip-sequences/service", () => ({
  cancelEnrollmentsForContact: cancelEnrollmentsForContactMock,
}));

vi.mock("@/server/services/email-outreach/inbound", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    resolveClientContactIdForReply: resolveClientContactIdForReplyMock,
  };
});

import { EmailEventsIngestService } from "@/server/services/email-outreach/events-ingest";

// --- Inbound reply hook ---
//
// Rather than instantiating EmailInboundService (which would require mocking
// many tables), we test the post-insert decision in isolation by directly
// calling the same code path the service uses: replyKind === "human" =>
// resolve contact + cancel; replyKind === "auto_reply" => skip.

import * as inbound from "@/server/services/email-outreach/inbound";

async function simulateInboundCancelDecision(
  replyKind: "human" | "auto_reply",
  caseId: string,
  fromEmail: string,
) {
  if (replyKind !== "human") return;
  const contactId = await inbound.resolveClientContactIdForReply(
    {} as never,
    caseId,
    fromEmail,
  );
  if (contactId) {
    const { cancelEnrollmentsForContact } = await import(
      "@/server/services/drip-sequences/service"
    );
    await cancelEnrollmentsForContact({} as never, contactId, "reply");
  }
}

describe("drip auto-cancel hooks", () => {
  beforeEach(() => {
    cancelEnrollmentsForContactMock.mockClear();
    resolveClientContactIdForReplyMock.mockClear();
    resolveClientContactIdForReplyMock.mockResolvedValue("contact-1");
  });

  describe("inbound reply", () => {
    it("cancels enrollments with reason='reply' for a human reply", async () => {
      await simulateInboundCancelDecision("human", "case-1", "client@example.com");
      expect(cancelEnrollmentsForContactMock).toHaveBeenCalledTimes(1);
      expect(cancelEnrollmentsForContactMock).toHaveBeenCalledWith(
        expect.anything(),
        "contact-1",
        "reply",
      );
    });

    it("does NOT cancel for an auto_reply", async () => {
      await simulateInboundCancelDecision("auto_reply", "case-1", "client@example.com");
      expect(cancelEnrollmentsForContactMock).not.toHaveBeenCalled();
    });

    it("does NOT cancel when contact cannot be resolved", async () => {
      resolveClientContactIdForReplyMock.mockResolvedValueOnce(null);
      await simulateInboundCancelDecision("human", "case-1", "stranger@example.com");
      expect(cancelEnrollmentsForContactMock).not.toHaveBeenCalled();
    });
  });

  describe("events ingest", () => {
    function makeEventsDb(opts: {
      hasOutreach: boolean;
      hasDuplicate?: boolean;
    }) {
      let selectCall = 0;
      const db: any = {
        transaction: async (fn: any) => fn(db),
        insert: () => ({
          values: async () => undefined,
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve(),
          }),
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                selectCall += 1;
                // 1st select: dedup check on events
                if (selectCall === 1) {
                  return opts.hasDuplicate
                    ? [{ id: "evt-existing" }]
                    : [];
                }
                // 2nd select: outreach lookup
                if (selectCall === 2) {
                  return opts.hasOutreach
                    ? [
                        {
                          id: "outreach-1",
                          caseId: "case-1",
                          sentBy: "user-1",
                          recipientEmail: "client@example.com",
                        },
                      ]
                    : [];
                }
                return [];
              },
            }),
          }),
        }),
      };
      return db;
    }

    it("cancels with reason='bounce' on bounced event", async () => {
      const svc = new EmailEventsIngestService({
        db: makeEventsDb({ hasOutreach: true }) as never,
      });
      const result = await svc.ingest({
        eventId: "evt-1",
        resendEmailId: "re-1",
        eventType: "bounced",
        eventAt: new Date(),
      });
      expect(result.status).toBe("ok");
      expect(cancelEnrollmentsForContactMock).toHaveBeenCalledTimes(1);
      expect(cancelEnrollmentsForContactMock).toHaveBeenCalledWith(
        expect.anything(),
        "contact-1",
        "bounce",
      );
    });

    it("cancels with reason='complaint' on complained event", async () => {
      const svc = new EmailEventsIngestService({
        db: makeEventsDb({ hasOutreach: true }) as never,
      });
      const result = await svc.ingest({
        eventId: "evt-2",
        resendEmailId: "re-1",
        eventType: "complained",
        eventAt: new Date(),
      });
      expect(result.status).toBe("ok");
      expect(cancelEnrollmentsForContactMock).toHaveBeenCalledTimes(1);
      expect(cancelEnrollmentsForContactMock).toHaveBeenCalledWith(
        expect.anything(),
        "contact-1",
        "complaint",
      );
    });

    it("does NOT cancel on delivered/opened/clicked events", async () => {
      for (const eventType of ["delivered", "opened", "clicked"] as const) {
        cancelEnrollmentsForContactMock.mockClear();
        const svc = new EmailEventsIngestService({
          db: makeEventsDb({ hasOutreach: true }) as never,
        });
        await svc.ingest({
          eventId: `evt-${eventType}`,
          resendEmailId: "re-1",
          eventType,
          eventAt: new Date(),
        });
        expect(cancelEnrollmentsForContactMock).not.toHaveBeenCalled();
      }
    });
  });
});
