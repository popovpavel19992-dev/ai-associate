// tests/integration/cases-client-link.test.ts
//
// Unit tests for the cases tRPC router — specifically the Wave 2 changes that
// link cases to clients: cases.create (requires clientId), cases.update (swaps
// clientId), and cases.getById (returns hydrated client field).
//
// Uses a chainable mock ctx.db (no real DB access), matching the convention
// established in tests/integration/clients-router.test.ts and
// client-contacts-router.test.ts. Real FK constraints are validated in UAT.

import { describe, it, expect } from "vitest";
import type { db as realDb } from "@/server/db";
import type { clients } from "@/server/db/schema/clients";
import type { cases } from "@/server/db/schema/cases";
import { casesRouter } from "@/server/trpc/routers/cases";

type ClientRow = typeof clients.$inferSelect;
type CaseRow = typeof cases.$inferSelect;

// Minimal user shape understood by the permission helpers inside the router.
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// ---------------------------------------------------------------------------
// Stable UUIDs — every id passed to router input must be a valid UUID.
// ---------------------------------------------------------------------------
const ID = {
  user: "11111111-1111-4111-a111-111111111111",
  org: "22222222-2222-4222-a222-222222222222",
  case: "33333333-3333-4333-a333-333333333333",
  client: "44444444-4444-4444-a444-444444444444",
  newClient: "55555555-5555-4555-a555-555555555555",
  foreignClient: "66666666-6666-4666-a666-666666666666",
  otherOrg: "99999999-9999-4999-a999-999999999999",
};

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------
const makeClientRow = (overrides: Partial<ClientRow> = {}): ClientRow =>
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

const makeCaseRow = (overrides: Partial<CaseRow> = {}): CaseRow =>
  ({
    id: ID.case,
    userId: ID.user,
    orgId: ID.org,
    clientId: ID.client,
    name: "Test Case",
    status: "draft",
    detectedCaseType: null,
    overrideCaseType: null,
    jurisdictionOverride: null,
    selectedSections: null,
    sectionsLocked: false,
    caseBrief: null,
    stageId: null,
    stageChangedAt: null,
    description: null,
    deleteAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as CaseRow;

// ---------------------------------------------------------------------------
// makeMockDb — chainable mock supporting select (queue-drained), insert, update.
// Follows the exact pattern from client-contacts-router.test.ts.
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];

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
      { id: ID.case, ...(call.set as object) },
    ],
  });

  const makeDeleteChain = (): DeleteChain => ({
    where: async (predicate: unknown) => {
      void predicate;
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
  };
}

// ---------------------------------------------------------------------------
// caller helper
// ---------------------------------------------------------------------------
// Cast through unknown to avoid requiring the full tRPC/Clerk context shape.
// The router only uses ctx.db and ctx.user (id, orgId, role) at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = (ctx: Ctx) => casesRouter.createCaller(ctx as unknown as any);

// ---------------------------------------------------------------------------
// cases.create — clientId linkage
// ---------------------------------------------------------------------------
describe("cases.create — clientId linkage", () => {
  it("solo user: creates case with clientId, skips caseMembers insert when no orgId", async () => {
    const { db, enqueueSelect, insertCalls, updateCalls } = makeMockDb();
    // Solo user — no orgId, no role
    const ctx: Ctx = { db, user: { id: ID.user, orgId: null, role: null } };

    // (1) assertClientRead SELECT on clients — solo client (orgId null, userId matches)
    enqueueSelect([makeClientRow({ id: ID.client, orgId: null, userId: ID.user })]);
    // (2) SELECT caseStages for intake → empty, so intake branch is skipped
    enqueueSelect([]);

    await caller(ctx).create({
      clientId: ID.client,
      name: "Solo Case",
    });

    // One insert: cases. caseMembers skipped (no orgId). No intake update.
    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.clientId).toBe(ID.client);
    expect(vals.name).toBe("Solo Case");
    expect(vals.userId).toBe(ID.user);
    expect(vals.orgId).toBeNull();

    // No update calls (intake skipped)
    expect(updateCalls).toHaveLength(0);
  });

  it("firm user: creates case + caseMembers insert + intake stage update + event insert", async () => {
    const { db, enqueueSelect, insertCalls, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // (1) assertClientRead SELECT on clients — firm client
    enqueueSelect([makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user })]);
    // (2) SELECT caseStages for intake → returns an intake stage
    enqueueSelect([{ id: "stage-intake-uuid", name: "Intake", caseType: "general", slug: "intake", sortOrder: 0 }]);

    await caller(ctx).create({
      clientId: ID.client,
      name: "Firm Case",
    });

    // Inserts: (0) cases, (1) caseMembers, (2) caseEvents
    expect(insertCalls).toHaveLength(3);

    const caseVals = insertCalls[0]!.values as Record<string, unknown>;
    expect(caseVals.clientId).toBe(ID.client);
    expect(caseVals.orgId).toBe(ID.org);

    const memberVals = insertCalls[1]!.values as Record<string, unknown>;
    expect(memberVals.role).toBe("lead");
    expect(memberVals.userId).toBe(ID.user);

    const eventVals = insertCalls[2]!.values as Record<string, unknown>;
    expect((eventVals.metadata as Record<string, unknown>).toStageName).toBe("Intake");

    // One update: cases.stageId = intake stage
    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.stageId).toBe("stage-intake-uuid");
  });

  it("foreign clientId: assertClientRead throws NOT_FOUND, no DB inserts occur", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertClientRead SELECT → empty (client not found / out-of-scope)
    enqueueSelect([]);

    await expect(
      caller(ctx).create({ clientId: ID.foreignClient, name: "Bad Case" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // No inserts should have occurred — assertClientRead threw before any INSERT
    expect(insertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// cases.update — clientId swap / rename
// ---------------------------------------------------------------------------
describe("cases.update — clientId swap and rename", () => {
  it("swap clientId: update payload contains new clientId", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // (1) assertCaseAccess SELECT
    enqueueSelect([{ id: ID.case }]);
    // (2) assertClientRead SELECT for new client
    enqueueSelect([makeClientRow({ id: ID.newClient, orgId: ID.org, userId: ID.user })]);

    await caller(ctx).update({ caseId: ID.case, clientId: ID.newClient });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.clientId).toBe(ID.newClient);
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });

  it("rename only (no clientId): payload has name but NO clientId key", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // (1) assertCaseAccess SELECT only (no assertClientRead since clientId omitted)
    enqueueSelect([{ id: ID.case }]);

    await caller(ctx).update({ caseId: ID.case, name: "Renamed Case" });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.name).toBe("Renamed Case");
    expect(setVals.updatedAt).toBeInstanceOf(Date);
    // clientId must NOT be present in the SET payload
    expect(Object.prototype.hasOwnProperty.call(setVals, "clientId")).toBe(false);
  });

  it("foreign clientId on update: NOT_FOUND, no UPDATE call occurs", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // (1) assertCaseAccess SELECT → success
    enqueueSelect([{ id: ID.case }]);
    // (2) assertClientRead SELECT → empty (foreign/not found)
    enqueueSelect([]);

    await expect(
      caller(ctx).update({ caseId: ID.case, clientId: ID.foreignClient }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // No update should have been called — assertClientRead threw before UPDATE
    expect(updateCalls).toHaveLength(0);
  });

  it("no-op update (neither name nor clientId): UPDATE still called with just updatedAt", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // (1) assertCaseAccess SELECT
    enqueueSelect([{ id: ID.case }]);
    // No assertClientRead — clientId omitted

    await caller(ctx).update({ caseId: ID.case });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.updatedAt).toBeInstanceOf(Date);
    expect(Object.prototype.hasOwnProperty.call(setVals, "clientId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(setVals, "name")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cases.getById — hydrated client field
// ---------------------------------------------------------------------------
describe("cases.getById — hydrated client field", () => {
  it("with linked client: returns client object with correct id", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    const clientRow = makeClientRow({ id: ID.client, orgId: ID.org, userId: ID.user });
    const caseRecord = makeCaseRow({ id: ID.case, clientId: ID.client });

    // getById SELECT order (verified against cases.ts):
    // (1) assertCaseAccess
    enqueueSelect([{ id: ID.case }]);
    // (2) SELECT cases WHERE id LIMIT 1
    enqueueSelect([caseRecord]);
    // (3) SELECT clients WHERE id LIMIT 1 (because clientId is non-null)
    enqueueSelect([clientRow]);
    // (4) SELECT documents WHERE caseId
    enqueueSelect([]);
    // (5) SELECT documentAnalyses WHERE caseId
    enqueueSelect([]);
    // (6) SELECT contracts WHERE linkedCaseId
    enqueueSelect([]);
    // (7) SELECT caseStages WHERE caseType (stages for the pipeline bar)
    enqueueSelect([]);
    // (8) stageTaskTemplates — skipped because currentStage is null (stageId=null + stages=[])
    // (9) SELECT caseEvents WHERE caseId
    enqueueSelect([]);

    const result = await caller(ctx).getById({ caseId: ID.case });

    expect(result.client).not.toBeNull();
    expect(result.client?.id).toBe(ID.client);
  });

  it("with null clientId: returns client === null, no clients SELECT fires", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // Case with clientId = null
    const caseRecord = makeCaseRow({ id: ID.case, clientId: null });

    // getById SELECT order (no clients SELECT because clientId is null):
    // (1) assertCaseAccess
    enqueueSelect([{ id: ID.case }]);
    // (2) SELECT cases WHERE id LIMIT 1
    enqueueSelect([caseRecord]);
    // (3) clients SELECT is skipped (short-circuit ternary)
    // (4) SELECT documents
    enqueueSelect([]);
    // (5) SELECT documentAnalyses
    enqueueSelect([]);
    // (6) SELECT contracts
    enqueueSelect([]);
    // (7) SELECT caseStages
    enqueueSelect([]);
    // (8) stageTaskTemplates — skipped (no currentStage)
    // (9) SELECT caseEvents
    enqueueSelect([]);

    const result = await caller(ctx).getById({ caseId: ID.case });

    expect(result.client).toBeNull();
  });
});
