// tests/unit/case-digest-send-service.test.ts
//
// Phase 3.18 — unit tests for sendDigestForUser. We mock aggregator,
// commentary, and email sending. The DB mock supports the preferences
// SELECT + the digestLogs INSERT + the digestPreferences upsert.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/case-digest/aggregator", () => ({
  aggregateForUser: vi.fn(),
}));
vi.mock("@/server/services/case-digest/ai-commentary", () => ({
  generateCommentary: vi.fn(async () => "test commentary"),
}));
vi.mock("@/server/services/email", () => ({
  sendEmail: vi.fn(async () => undefined),
}));

import { sendDigestForUser } from "@/server/services/case-digest/send-service";
import { aggregateForUser } from "@/server/services/case-digest/aggregator";
import { sendEmail } from "@/server/services/email";

const USER_ID = "00000000-0000-0000-0000-000000000001";

interface State {
  prefs: Record<string, unknown> | null;
  inserted: { logs: unknown[]; prefsUpserts: unknown[] };
}

function makeMockDb(state: State) {
  return {
    select() {
      const proxy: Record<string, unknown> = {};
      proxy.from = (_tbl: unknown) => {
        const chain: Record<string, unknown> = {};
        chain.where = () => chain;
        chain.limit = () => chain;
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve(state.prefs ? [state.prefs] : []).then(resolve);
        return chain;
      };
      return proxy;
    },
    insert(tbl: unknown) {
      const chain: Record<string, unknown> = {};
      let captured: unknown;
      chain.values = (v: unknown) => {
        captured = v;
        return chain;
      };
      chain.onConflictDoUpdate = () => {
        // Track upsert
        state.inserted.prefsUpserts.push(captured);
        return Promise.resolve();
      };
      chain.returning = () => {
        state.inserted.logs.push(captured);
        return Promise.resolve([{ id: "log-1" }]);
      };
      // Make chain awaitable for plain inserts
      chain.then = (resolve: (v: unknown) => unknown) => {
        state.inserted.logs.push(captured);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    },
  } as unknown as Parameters<typeof sendDigestForUser>[0];
}

function basePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: { id: USER_ID, name: "Tester", email: "t@example.com" },
    date: "2026-04-24",
    upcomingDeadlines: [],
    unreadClientMessages: [],
    unreadEmailReplies: [],
    newIntakeSubmissions: [],
    pendingSuggestedTimeEntries: { count: 0, oldestSessionDate: null },
    overdueDiscoveryResponses: [],
    todayStageChanges: [],
    isOoo: false,
    totalActionItems: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendDigestForUser", () => {
  it("skips when no preferences row", async () => {
    const state: State = { prefs: null, inserted: { logs: [], prefsUpserts: [] } };
    const db = makeMockDb(state);
    const out = await sendDigestForUser(db, USER_ID);
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("no_prefs");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips when disabled", async () => {
    const state: State = {
      prefs: { enabled: false, frequency: "daily", deliveryTimeUtc: "17:00" },
      inserted: { logs: [], prefsUpserts: [] },
    };
    const out = await sendDigestForUser(makeMockDb(state), USER_ID);
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("disabled");
  });

  it("skips when frequency=off", async () => {
    const state: State = {
      prefs: { enabled: true, frequency: "off", deliveryTimeUtc: "17:00" },
      inserted: { logs: [], prefsUpserts: [] },
    };
    const out = await sendDigestForUser(makeMockDb(state), USER_ID);
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("off");
  });

  it("skips when OOO", async () => {
    const state: State = {
      prefs: { enabled: true, frequency: "daily", deliveryTimeUtc: "17:00" },
      inserted: { logs: [], prefsUpserts: [] },
    };
    (aggregateForUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      basePayload({ isOoo: true, totalActionItems: 5 }),
    );
    const out = await sendDigestForUser(makeMockDb(state), USER_ID);
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("ooo");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips when zero items", async () => {
    const state: State = {
      prefs: { enabled: true, frequency: "daily", deliveryTimeUtc: "17:00" },
      inserted: { logs: [], prefsUpserts: [] },
    };
    (aggregateForUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      basePayload({ totalActionItems: 0 }),
    );
    const out = await sendDigestForUser(makeMockDb(state), USER_ID);
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("no_items");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends + logs when items present", async () => {
    const state: State = {
      prefs: { enabled: true, frequency: "daily", deliveryTimeUtc: "17:00" },
      inserted: { logs: [], prefsUpserts: [] },
    };
    (aggregateForUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      basePayload({
        totalActionItems: 3,
        upcomingDeadlines: [
          { caseId: "c1", caseName: "Smith", title: "MSJ", dueDate: "2026-04-26", daysUntil: 2 },
        ],
      }),
    );
    const out = await sendDigestForUser(makeMockDb(state), USER_ID);
    expect(out.sent).toBe(true);
    expect(out.logId).toBe("log-1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(state.inserted.logs.length).toBeGreaterThan(0);
    expect(state.inserted.prefsUpserts.length).toBe(1);
  });
});
