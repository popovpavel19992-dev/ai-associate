// tests/unit/push-subscription-service.test.ts
//
// Phase 3.16 — PWA Upgrade.
//
// Covers the push fanout helper in src/server/services/push.ts:
//   - send happy path → returns sent counter, bumps last_used_at
//   - 410 Gone → sub marked is_active = false (deactivated counter)
//   - 404 Not Found → also deactivated
//   - non-410 failure → counted as failed but NOT deactivated
//   - empty subscription list → returns zeros without calling web-push
//
// We mock the web-push module before importing the service so VAPID init never
// runs (no env required).

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

// Stub out the schema import — service only uses it as a table reference.
vi.mock("@/server/db/schema/push-subscriptions", () => ({
  pushSubscriptions: { id: "id", userId: "user_id", isActive: "is_active" },
}));

// Stub @/server/db so importing service doesn't pull postgres connection.
vi.mock("@/server/db", () => ({}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
}));

// Re-imported per-test to reset the lazy initialized flag inside the service.
async function loadService() {
  vi.resetModules();
  setVapidDetailsMock.mockClear();
  sendNotificationMock.mockReset();
  process.env.VAPID_PUBLIC_KEY = "pub-key";
  process.env.VAPID_PRIVATE_KEY = "priv-key";
  process.env.VAPID_SUBJECT = "mailto:test@clearterms.ai";
  return await import("@/server/services/push");
}

interface FakeSub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function makeDb(subs: FakeSub[]) {
  const updateCalls: Array<{ id: string; set: Record<string, unknown> }> = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(subs),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (cond: { _eq: [unknown, string] }) => {
          updateCalls.push({ id: cond._eq[1], set });
          return Promise.resolve();
        },
      }),
    }),
  };

  return { db: db as never, updateCalls };
}

describe("sendNotificationToUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros and skips web-push when no active subscriptions", async () => {
    const { sendNotificationToUser } = await loadService();
    const { db, updateCalls } = makeDb([]);

    const result = await sendNotificationToUser(db, "user-1", {
      title: "t",
      body: "b",
    });

    expect(result).toEqual({ sent: 0, failed: 0, deactivated: 0 });
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("sends successfully and bumps last_used_at", async () => {
    const { sendNotificationToUser } = await loadService();
    const subs: FakeSub[] = [
      { id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1" },
      { id: "s2", endpoint: "https://push/2", p256dh: "k2", auth: "a2" },
    ];
    const { db, updateCalls } = makeDb(subs);
    sendNotificationMock.mockResolvedValue(undefined);

    const result = await sendNotificationToUser(db, "user-1", {
      title: "Hello",
      body: "World",
      url: "/dashboard",
      tag: "x",
    });

    expect(result).toEqual({ sent: 2, failed: 0, deactivated: 0 });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);

    // Two last_used_at bumps, no deactivations
    expect(updateCalls).toHaveLength(2);
    for (const c of updateCalls) {
      expect(c.set).toHaveProperty("lastUsedAt");
    }

    // Payload was JSON-stringified with the right fields
    const payload = JSON.parse(sendNotificationMock.mock.calls[0]?.[1] as string);
    expect(payload).toMatchObject({
      title: "Hello",
      body: "World",
      url: "/dashboard",
      tag: "x",
    });
    expect(payload.icon).toBe("/icons/icon-192.png");
  });

  it("marks subscription inactive on 410 Gone", async () => {
    const { sendNotificationToUser } = await loadService();
    const { db, updateCalls } = makeDb([
      { id: "gone", endpoint: "https://push/gone", p256dh: "k", auth: "a" },
    ]);
    sendNotificationMock.mockRejectedValue({ statusCode: 410 });

    const result = await sendNotificationToUser(db, "u", { title: "t", body: "b" });

    expect(result).toEqual({ sent: 0, failed: 0, deactivated: 1 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.id).toBe("gone");
    expect(updateCalls[0]?.set).toEqual({ isActive: false });
  });

  it("marks subscription inactive on 404 Not Found", async () => {
    const { sendNotificationToUser } = await loadService();
    const { db, updateCalls } = makeDb([
      { id: "missing", endpoint: "https://push/x", p256dh: "k", auth: "a" },
    ]);
    sendNotificationMock.mockRejectedValue({ statusCode: 404 });

    const result = await sendNotificationToUser(db, "u", { title: "t", body: "b" });

    expect(result.deactivated).toBe(1);
    expect(updateCalls[0]?.set).toEqual({ isActive: false });
  });

  it("counts non-410 failures without deactivating the subscription", async () => {
    const { sendNotificationToUser } = await loadService();
    const { db, updateCalls } = makeDb([
      { id: "still-good", endpoint: "https://push/y", p256dh: "k", auth: "a" },
    ]);
    sendNotificationMock.mockRejectedValue({ statusCode: 500 });

    const result = await sendNotificationToUser(db, "u", { title: "t", body: "b" });

    expect(result).toEqual({ sent: 0, failed: 1, deactivated: 0 });
    expect(updateCalls).toHaveLength(0);
  });
});

describe("getVapidPublicKey", () => {
  it("returns the env value when set", async () => {
    const { getVapidPublicKey } = await loadService();
    expect(getVapidPublicKey()).toBe("pub-key");
  });

  it("returns null when env missing", async () => {
    vi.resetModules();
    delete process.env.VAPID_PUBLIC_KEY;
    const mod = await import("@/server/services/push");
    expect(mod.getVapidPublicKey()).toBeNull();
  });
});
