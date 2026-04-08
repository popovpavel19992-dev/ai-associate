// tests/integration/clients-router.test.ts
//
// Unit tests for the clients tRPC router. Uses a chainable mock ctx.db (no
// real DB access), matching the existing tests/integration/clients-permissions
// convention. Real SQL semantics are validated in manual UAT (Task 37).

import { describe, it, expect } from "vitest";
import type { db as realDb } from "@/server/db";
import type { clients } from "@/server/db/schema/clients";
import { clientsRouter } from "@/server/trpc/routers/clients";

type ClientRow = typeof clients.$inferSelect;

// Minimal user shape understood by the permission helpers inside the router.
// We cast to the full tRPC context type via `as unknown` when calling createCaller.
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// ---------------------------------------------------------------------------
// Stable UUIDs — all IDs passed to router input must be valid UUIDs.
// ---------------------------------------------------------------------------
const ID = {
  client: "11111111-1111-4111-a111-111111111111",
  user: "22222222-2222-4222-a222-222222222222",
  org: "33333333-3333-4333-a333-333333333333",
  member: "44444444-4444-4444-a444-444444444444",
  owner: "55555555-5555-4555-a555-555555555555",
  otherUser: "66666666-6666-4666-a666-666666666666",
  solo: "77777777-7777-4777-a777-777777777777",
};

// ---------------------------------------------------------------------------
// makeRow — copied verbatim from clients-permissions.test.ts, with UUID defaults
// ---------------------------------------------------------------------------
const makeRow = (overrides: Partial<ClientRow>): ClientRow =>
  ({
    id: ID.client,
    orgId: null,
    userId: ID.user,
    clientType: "individual",
    displayName: "Test Client",
    status: "active",
    firstName: "Test",
    lastName: "Client",
    dateOfBirth: null,
    companyName: null,
    ein: null,
    industry: null,
    website: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zipCode: null,
    country: "US",
    notes: null,
    searchVector: null as unknown as string,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ClientRow;

// ---------------------------------------------------------------------------
// makeMockDb — chainable mock supporting select (queue-drained), insert, update
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];

  const selectChain: {
    from: () => typeof selectChain;
    where: () => typeof selectChain;
    orderBy: () => typeof selectChain;
    limit: () => typeof selectChain;
    offset: () => typeof selectChain;
    then: (
      resolve: (v: SelectResponse) => void,
      reject: (e: Error) => void,
    ) => void;
  } = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => selectChain,
    offset: () => selectChain,
    then: (resolve, reject) => {
      const v = selectQueue.shift();
      if (v === undefined) {
        reject(new Error("mock db: select queue exhausted"));
        return;
      }
      resolve(v);
    },
  };

  interface InsertChain {
    values: (v: unknown) => InsertChain;
    returning: () => Promise<unknown[]>;
  }

  interface UpdateChain {
    set: (s: unknown) => UpdateChain;
    where: () => UpdateChain;
    returning: () => Promise<unknown[]>;
  }

  const makeInsertChain = (call: { values?: unknown }): InsertChain => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    returning: async () => [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", ...(call.values as object) }],
  });

  const makeUpdateChain = (call: { set?: unknown }): UpdateChain => ({
    set: (s: unknown) => {
      call.set = s;
      return makeUpdateChain(call);
    },
    where: () => makeUpdateChain(call),
    returning: async () => [{ id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", ...(call.set as object) }],
  });

  const db = {
    select: () => selectChain,
    insert: () => {
      const call: { values?: unknown } = {};
      insertCalls.push(call);
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      updateCalls.push(call);
      return makeUpdateChain(call);
    },
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
  };
}

// ---------------------------------------------------------------------------
// caller helper
// ---------------------------------------------------------------------------
// Cast through unknown to avoid requiring the full Clerk/DB context shape.
// The router only uses ctx.db and ctx.user (id, orgId, role) at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = (ctx: Ctx) => clientsRouter.createCaller(ctx as unknown as any);

// ---------------------------------------------------------------------------
// clients.create
// ---------------------------------------------------------------------------
describe("clients.create", () => {
  it("individual: inserts correct values including nulled org-only fields", async () => {
    const { db, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    await caller(ctx).create({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;

    expect(vals.displayName).toBe("Jane Doe");
    expect(vals.firstName).toBe("Jane");
    expect(vals.lastName).toBe("Doe");
    expect(vals.companyName).toBeNull();
    expect(vals.ein).toBeNull();
    expect(vals.industry).toBeNull();
    expect(vals.website).toBeNull();
    expect(vals.orgId).toBe(ID.org);
    expect(vals.userId).toBe(ID.user);
    expect(vals.country).toBe("US");
  });

  it("organization: inserts correct values including nulled individual-only fields", async () => {
    const { db, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "admin" } };

    await caller(ctx).create({
      clientType: "organization",
      companyName: "Acme Corp",
      country: "US",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;

    expect(vals.displayName).toBe("Acme Corp");
    expect(vals.companyName).toBe("Acme Corp");
    expect(vals.firstName).toBeNull();
    expect(vals.lastName).toBeNull();
    expect(vals.dateOfBirth).toBeNull();
  });

  it("solo user: inserts with orgId null and correct userId", async () => {
    const { db, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };

    await caller(ctx).create({
      clientType: "individual",
      firstName: "Solo",
      lastName: "User",
      country: "US",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;

    expect(vals.orgId).toBeNull();
    expect(vals.userId).toBe(ID.solo);
  });
});

// ---------------------------------------------------------------------------
// clients.update — displayName recomputation
// ---------------------------------------------------------------------------
describe("clients.update", () => {
  it("recomputes displayName when patching firstName on individual", async () => {
    const { db, updateCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // assertClientEdit → assertClientRead: enqueue existing row
    const existing = makeRow({
      id: ID.client,
      orgId: ID.org,
      userId: ID.user,
      clientType: "individual",
      firstName: "Old",
      lastName: "Name",
      displayName: "Old Name",
    });
    enqueueSelect([existing]);

    await caller(ctx).update({
      id: ID.client,
      patch: { firstName: "New" },
    });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.displayName).toBe("New Name");
  });
});

// ---------------------------------------------------------------------------
// clients.update — cross-type field filter (Issue 2 regression)
// ---------------------------------------------------------------------------
describe("clients.update cross-type filter", () => {
  it("individual: org-only fields are stripped from patch", async () => {
    const { db, updateCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    const existing = makeRow({
      id: ID.client,
      orgId: ID.org,
      userId: ID.user,
      clientType: "individual",
      firstName: "Still",
      lastName: "Name",
      displayName: "Still Name",
    });
    enqueueSelect([existing]);

    await caller(ctx).update({
      id: ID.client,
      patch: { firstName: "Still", companyName: "Sneaky Corp" },
    });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(setVals, "companyName")).toBe(false);
    expect(setVals.firstName).toBe("Still");
    expect(setVals.displayName).toBe("Still Name");
  });

  it("organization: individual-only fields are stripped from patch", async () => {
    const { db, updateCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "admin" } };

    const existing = makeRow({
      id: ID.client,
      orgId: ID.org,
      userId: ID.user,
      clientType: "organization",
      companyName: "Old Corp",
      displayName: "Old Corp",
      firstName: null,
      lastName: null,
    });
    enqueueSelect([existing]);

    await caller(ctx).update({
      id: ID.client,
      patch: { firstName: "Bogus", companyName: "New Corp" },
    });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(setVals, "firstName")).toBe(false);
    expect(setVals.companyName).toBe("New Corp");
    expect(setVals.displayName).toBe("New Corp");
  });
});

// ---------------------------------------------------------------------------
// clients.archive / restore
// ---------------------------------------------------------------------------
describe("clients.archive/restore", () => {
  it("archive: firm member is forbidden", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    // assertClientManage → assertClientRead: returns a firm client
    enqueueSelect([makeRow({ id: ID.client, orgId: ID.org, userId: ID.otherUser })]);

    await expect(
      caller(ctx).archive({ id: ID.client }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("archive: owner succeeds and sets status to archived", async () => {
    const { db, updateCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    // assertClientManage → assertClientRead
    enqueueSelect([makeRow({ id: ID.client, orgId: ID.org, userId: ID.otherUser })]);

    await caller(ctx).archive({ id: ID.client });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.status).toBe("archived");
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });

  it("restore: owner succeeds and sets status to active", async () => {
    const { db, updateCalls, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    // assertClientManage → assertClientRead
    enqueueSelect([makeRow({ id: ID.client, orgId: ID.org, userId: ID.otherUser })]);

    await caller(ctx).restore({ id: ID.client });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.status).toBe("active");
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Smoke tests: list / getById / searchForPicker / getCases
// ---------------------------------------------------------------------------
describe("clients.list / getById / searchForPicker / getCases (smoke)", () => {
  it("list: returns clients and total from mock", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) rows query, (2) count query
    enqueueSelect([]);
    enqueueSelect([{ count: 0 }]);

    const result = await caller(ctx).list({});
    expect(result).toMatchObject({ clients: [], total: 0 });
  });

  it("getById: returns client, contacts, and caseCount", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    const row = makeRow({ id: ID.client, orgId: ID.org, userId: ID.user });
    // (1) assertClientRead, (2) contacts, (3) caseCount
    enqueueSelect([row]);
    enqueueSelect([]);
    enqueueSelect([{ count: 0 }]);

    const result = await caller(ctx).getById({ id: ID.client });
    expect(result.client.id).toBe(ID.client);
    expect(result.contacts).toEqual([]);
    expect(result.caseCount).toBe(0);
  });

  it("searchForPicker: returns clients array", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    enqueueSelect([]);

    const result = await caller(ctx).searchForPicker({ q: "acme" });
    expect(result).toMatchObject({ clients: [] });
  });

  it("getCases: returns cases array", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    const row = makeRow({ id: ID.client, orgId: ID.org, userId: ID.user });
    // (1) assertClientRead, (2) cases select
    enqueueSelect([row]);
    enqueueSelect([]);

    const result = await caller(ctx).getCases({ clientId: ID.client });
    expect(result).toMatchObject({ cases: [] });
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
describe("clients input validation", () => {
  it("create individual: empty firstName is rejected by zod (min(1))", async () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };

    await expect(
      caller(ctx).create({
        clientType: "individual",
        firstName: "",
        lastName: "Doe",
        country: "US",
      }),
    ).rejects.toThrow();
  });

  it("create individual: country defaults to US when omitted", async () => {
    const { db, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };

    await caller(ctx).create({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
      // country intentionally omitted — schema default is "US"
    } as Parameters<ReturnType<typeof caller>["create"]>[0]);

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.country).toBe("US");
  });

  it("update: clientType in patch is rejected by zod strict()", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // Enqueue row in case validation passes (it shouldn't)
    enqueueSelect([makeRow({ id: ID.client, orgId: ID.org })]);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      caller(ctx).update({ id: ID.client, patch: { clientType: "organization" } as any }),
    ).rejects.toThrow();
  });
});
