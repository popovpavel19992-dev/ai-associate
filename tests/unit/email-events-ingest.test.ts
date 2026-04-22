// tests/unit/email-events-ingest.test.ts
import { describe, it, expect } from "vitest";
import { EmailEventsIngestService, type EventPayload } from "@/server/services/email-outreach/events-ingest";

function makeMockDb(opts: {
  existingEventId?: string;
  existingOutreach?: { id: string; caseId: string; sentBy: string } | null;
}) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
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
        where: () => {
          updates.push({ table: t, set: s });
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
              return opts.existingEventId ? [{ id: "existing" }] : [];
            }
            if (selectCallCount === 2) {
              return opts.existingOutreach ? [opts.existingOutreach] : [];
            }
            return [];
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

const OUTREACH = { id: "o1", caseId: "c1", sentBy: "u1" };
const BASE_AT = new Date("2026-04-21T10:00:00Z");

function mkPayload(overrides: Partial<EventPayload> = {}): EventPayload {
  return {
    eventId: "evt_1",
    resendEmailId: "re_abc",
    eventType: "opened",
    eventAt: BASE_AT,
    metadata: {},
    ...overrides,
  };
}

describe("EmailEventsIngestService.ingest", () => {
  it("duplicate eventId → no-op", async () => {
    const { db, inserts, updates } = makeMockDb({ existingEventId: "evt_1" });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload());
    expect(res.status).toBe("duplicate");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("no-parent outreach → no-op", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: null });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload());
    expect(res.status).toBe("no-parent");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("unknown event type → skip", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "weird" as any }));
    expect(res.status).toBe("skipped");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("delivered → sets delivered_at, inserts event, no counters", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "delivered" }));
    expect(res.status).toBe("ok");
    expect(inserts.length).toBe(1);
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("deliveredAt");
  });

  it("opened → increments open_count + first/last", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "opened" }));
    expect(res.status).toBe("ok");
    expect(inserts.length).toBe(1);
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("openCount");
    expect(setObj).toHaveProperty("lastOpenedAt");
  });

  it("clicked → increments click_count + first/last + metadata", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "clicked", metadata: { url: "https://portal" } }));
    expect(res.status).toBe("ok");
    const eventRow = inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return v.eventType === "clicked";
    })!.values as Record<string, unknown>;
    expect(eventRow.metadata).toEqual({ url: "https://portal" });
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("clickCount");
  });

  it("complained → sets complainedAt + inserts notification", async () => {
    const { db, inserts, updates } = makeMockDb({ existingOutreach: OUTREACH });
    const svc = new EmailEventsIngestService({ db });
    const res = await svc.ingest(mkPayload({ eventType: "complained" }));
    expect(res.status).toBe("ok");
    const notifInserts = inserts.filter((i) => {
      const v = i.values as Record<string, unknown>;
      return v && v.type === "email_complained";
    });
    expect(notifInserts.length).toBe(1);
    const setObj = updates[0].set as Record<string, unknown>;
    expect(setObj).toHaveProperty("complainedAt");
  });
});
