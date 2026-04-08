// tests/integration/client-contacts-router.test.ts
//
// Unit tests for the clientContacts tRPC router. Uses a chainable mock
// ctx.db (no real DB access), matching the convention in
// tests/integration/clients-router.test.ts and clients-permissions.test.ts.
// Real SQL constraints (partial unique index on is_primary, FK cascade,
// etc.) are validated in manual UAT (Task 37).

import { describe, it, expect } from "vitest";
import type { db as realDb } from "@/server/db";
import type { clients } from "@/server/db/schema/clients";
import type { clientContacts } from "@/server/db/schema/client-contacts";
import { clientContactsRouter } from "@/server/trpc/routers/client-contacts";

type ClientRow = typeof clients.$inferSelect;
type ContactRow = typeof clientContacts.$inferSelect;

// Minimal user shape understood by the permission helpers inside the router.
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// ---------------------------------------------------------------------------
// Stable UUIDs — every id passed to router input must be a valid UUID.
// ---------------------------------------------------------------------------
const ID = {
  client: "11111111-1111-4111-a111-111111111111",
  user: "22222222-2222-4222-a222-222222222222",
  org: "33333333-3333-4333-a333-333333333333",
  contact: "44444444-4444-4444-a444-444444444444",
  nextContact: "55555555-5555-4555-a555-555555555555",
  otherOrg: "99999999-9999-4999-a999-999999999999",
};

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------
const makeClientRow = (overrides: Partial<ClientRow>): ClientRow =>
  ({
    id: ID.client,
    orgId: ID.org,
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

const makeContactRow = (overrides: Partial<ContactRow>): ContactRow =>
  ({
    id: ID.contact,
    clientId: ID.client,
    name: "Alice Example",
    title: null,
    email: null,
    phone: null,
    isPrimary: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ContactRow;

// ---------------------------------------------------------------------------
// makeMockDb — chainable mock supporting select (queue-drained), insert,
// update, delete, and transaction. Closure-shared call arrays mean
// transactions are observed identically to top-level db calls.
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  const deleteCalls: unknown[] = [];

  const makeSelectChain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve: (v: SelectResponse) => void, reject: (e: Error) => void) => {
        const v = selectQueue.shift();
        if (v === undefined) {
          reject(new Error("mock db: select queue exhausted"));
          return;
        }
        resolve(v);
      },
    };
    return chain;
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

  interface DeleteChain {
    where: (predicate: unknown) => Promise<void>;
  }

  const makeInsertChain = (call: { values?: unknown }): InsertChain => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    returning: async () => [
      { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", ...(call.values as object) },
    ],
  });

  const makeUpdateChain = (call: { set?: unknown }): UpdateChain => ({
    set: (s: unknown) => {
      call.set = s;
      return makeUpdateChain(call);
    },
    where: () => makeUpdateChain(call),
    returning: async () => [
      { id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", ...(call.set as object) },
    ],
  });

  const makeDeleteChain = (): DeleteChain => ({
    where: async (predicate: unknown) => {
      deleteCalls.push(predicate);
    },
  });

  const baseDb = {
    select: () => makeSelectChain(),
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
    delete: () => makeDeleteChain(),
  };

  // transaction() mock: the callback receives a tx that delegates back to
  // baseDb. Closure-shared queues/arrays mean tx operations are recorded
  // the same way as top-level operations.
  const db = {
    ...baseDb,
    transaction: async <T>(
      callback: (tx: typeof baseDb) => Promise<T>,
    ): Promise<T> => {
      return callback(baseDb);
    },
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    deleteCalls,
  };
}

// ---------------------------------------------------------------------------
// caller helper
// ---------------------------------------------------------------------------
// Cast through unknown to avoid requiring the full tRPC/Clerk context shape.
// The router only uses ctx.db and ctx.user (id, orgId, role) at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = (ctx: Ctx) => clientContactsRouter.createCaller(ctx as unknown as any);

// ---------------------------------------------------------------------------
// clientContacts.create
// ---------------------------------------------------------------------------
describe("clientContacts.create", () => {
  it("first contact does not auto-promote unless isPrimary is set", async () => {
    const { db, enqueueSelect, insertCalls, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // assertClientEdit → assertClientRead: enqueue the client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);

    await caller(ctx).create({
      clientId: ID.client,
      name: "Alice",
    });

    // No demote fired (isPrimary defaulted to false)
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(1);

    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.isPrimary).toBe(false);
    expect(vals.name).toBe("Alice");
    expect(vals.clientId).toBe(ID.client);
  });

  it("isPrimary=true unsets prior primary atomically within the transaction", async () => {
    const { db, enqueueSelect, insertCalls, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // assertClientEdit → assertClientRead
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);

    await caller(ctx).create({
      clientId: ID.client,
      name: "Bob",
      isPrimary: true,
    });

    // Demote fired, then insert
    expect(updateCalls).toHaveLength(1);
    const demoteSet = updateCalls[0]!.set as Record<string, unknown>;
    expect(demoteSet.isPrimary).toBe(false);

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.isPrimary).toBe(true);
    expect(vals.name).toBe("Bob");
  });
});

// ---------------------------------------------------------------------------
// clientContacts.update
// ---------------------------------------------------------------------------
describe("clientContacts.update", () => {
  it("patch.isPrimary=true on currently-non-primary triggers demote-then-update", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) loadContactForEdit → contact row (isPrimary: false)
    enqueueSelect([makeContactRow({ id: ID.contact, clientId: ID.client, isPrimary: false })]);
    // (2) assertClientEdit → client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);

    await caller(ctx).update({
      id: ID.contact,
      patch: { isPrimary: true },
    });

    expect(updateCalls).toHaveLength(2);

    // First update: demote-all (set isPrimary: false on prior primary)
    const demoteSet = updateCalls[0]!.set as Record<string, unknown>;
    expect(demoteSet.isPrimary).toBe(false);

    // Second update: set target contact to primary
    const targetSet = updateCalls[1]!.set as Record<string, unknown>;
    expect(targetSet.isPrimary).toBe(true);
  });

  it("patch with non-primary field does not fire demote", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) existing contact that is already primary
    enqueueSelect([makeContactRow({ id: ID.contact, clientId: ID.client, isPrimary: true })]);
    // (2) client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);

    await caller(ctx).update({
      id: ID.contact,
      patch: { name: "Renamed" },
    });

    // Only one update call (no demote). The set-target update applies the
    // patch fields as-is. Note: contactSchema.partial() still applies the
    // default `isPrimary: false`, so the set may include `isPrimary: false`
    // — but because `existing.isPrimary === true`, the demote branch
    // (patch.isPrimary === true && !existing.isPrimary) does NOT fire.
    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.name).toBe("Renamed");
  });
});

// ---------------------------------------------------------------------------
// clientContacts.setPrimary
// ---------------------------------------------------------------------------
describe("clientContacts.setPrimary", () => {
  it("swaps primary atomically (demote-all then set-target)", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) existing contact currently non-primary
    enqueueSelect([makeContactRow({ id: ID.contact, clientId: ID.client, isPrimary: false })]);
    // (2) client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);

    await caller(ctx).setPrimary({ id: ID.contact });

    expect(updateCalls).toHaveLength(2);

    const demoteSet = updateCalls[0]!.set as Record<string, unknown>;
    expect(demoteSet.isPrimary).toBe(false);

    const targetSet = updateCalls[1]!.set as Record<string, unknown>;
    expect(targetSet.isPrimary).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clientContacts.delete
// ---------------------------------------------------------------------------
describe("clientContacts.delete", () => {
  it("promotes oldest remaining contact when a primary contact is deleted", async () => {
    const { db, enqueueSelect, deleteCalls, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) existing contact — primary
    enqueueSelect([makeContactRow({ id: ID.contact, clientId: ID.client, isPrimary: true })]);
    // (2) client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);
    // (3) promote-oldest select returns the next contact
    enqueueSelect([
      makeContactRow({
        id: ID.nextContact,
        clientId: ID.client,
        name: "Second",
        isPrimary: false,
      }),
    ]);

    await caller(ctx).delete({ id: ID.contact });

    expect(deleteCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);

    const promoteSet = updateCalls[0]!.set as Record<string, unknown>;
    expect(promoteSet.isPrimary).toBe(true);
  });

  it("does not promote when primary is deleted and no contacts remain", async () => {
    const { db, enqueueSelect, deleteCalls, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) existing contact — primary
    enqueueSelect([makeContactRow({ id: ID.contact, clientId: ID.client, isPrimary: true })]);
    // (2) client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);
    // (3) promote-oldest select returns nothing
    enqueueSelect([]);

    await caller(ctx).delete({ id: ID.contact });

    expect(deleteCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(0);
  });

  it("non-primary delete skips the promote-oldest path entirely", async () => {
    const { db, enqueueSelect, deleteCalls, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) existing contact — non-primary
    enqueueSelect([makeContactRow({ id: ID.contact, clientId: ID.client, isPrimary: false })]);
    // (2) client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);
    // NOTE: no third enqueue — if the router erroneously calls the
    // next-select, the select queue will be exhausted and the test fails.

    await caller(ctx).delete({ id: ID.contact });

    expect(deleteCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// clientContacts.list (smoke) + permission smoke
// ---------------------------------------------------------------------------
describe("clientContacts.list", () => {
  it("returns contacts array from the mock", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // (1) assertClientRead → client row
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);
    // (2) contacts query
    enqueueSelect([]);

    const result = await caller(ctx).list({ clientId: ID.client });
    expect(result.contacts).toEqual([]);
  });

  it("firm member with mismatched orgId is rejected with NOT_FOUND", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "member" } };

    // Client belongs to a different org than the caller — assertClientRead
    // uses NOT_FOUND (not FORBIDDEN) to avoid leaking existence.
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.otherOrg, userId: ID.user })]);

    await expect(
      caller(ctx).list({ clientId: ID.client }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
