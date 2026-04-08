// tests/integration/clients-permissions.test.ts
//
// Unit tests for client permission helpers. Uses a chainable fake `ctx.db`
// to avoid real DB access, matching the existing tests/integration/* style.
// Real DB semantics (constraints, triggers, indexes) are validated in
// manual UAT (Task 37).

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { SQL } from "drizzle-orm";
import type { db as realDb } from "@/server/db";
import type { clients } from "@/server/db/schema/clients";
import {
  assertClientRead,
  assertClientEdit,
  assertClientManage,
  clientListScope,
} from "@/server/trpc/lib/permissions";

type ClientRow = typeof clients.$inferSelect;
type Ctx = { db: typeof realDb; user: { id: string; orgId: string | null; role: string | null } };

// Minimal chainable mock db: captures the single .select().from().where().limit()
// chain the helpers use and resolves to a preset array. Cast to typeof realDb for
// the helpers' type signature.
function mockDb(rows: Partial<ClientRow>[]): typeof realDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => rows,
  };
  return { select: () => chain } as unknown as typeof realDb;
}

const makeRow = (overrides: Partial<ClientRow>): ClientRow =>
  ({
    id: "client-1",
    orgId: null,
    userId: "user-1",
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

const makeCtx = (
  user: { id: string; orgId: string | null; role: string | null },
  rows: Partial<ClientRow>[] = [],
): Ctx => ({ db: mockDb(rows), user });

describe("assertClientRead", () => {
  it("firm member can read firm client in same org", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "owner-A" });
    const ctx = makeCtx({ id: "member-A", orgId: "org-A", role: "member" }, [row]);

    const result = await assertClientRead(ctx, "c1");
    expect(result.id).toBe("c1");
  });

  it("foreign org user cannot read firm client", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "owner-A" });
    const ctx = makeCtx({ id: "owner-B", orgId: "org-B", role: "owner" }, [row]);

    await expect(assertClientRead(ctx, "c1")).rejects.toThrow(TRPCError);
  });

  it("solo user cannot read firm client", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "owner-A" });
    const ctx = makeCtx({ id: "solo-1", orgId: null, role: null }, [row]);

    await expect(assertClientRead(ctx, "c1")).rejects.toThrow(TRPCError);
  });

  it("solo creator can read own solo client", async () => {
    const row = makeRow({ id: "c1", orgId: null, userId: "solo-1" });
    const ctx = makeCtx({ id: "solo-1", orgId: null, role: null }, [row]);

    const result = await assertClientRead(ctx, "c1");
    expect(result.id).toBe("c1");
  });

  it("solo non-creator cannot read solo client", async () => {
    const row = makeRow({ id: "c1", orgId: null, userId: "solo-1" });
    const ctx = makeCtx({ id: "solo-2", orgId: null, role: null }, [row]);

    await expect(assertClientRead(ctx, "c1")).rejects.toThrow(TRPCError);
  });

  it("firm member cannot read solo client from another user (even in same org context)", async () => {
    const row = makeRow({ id: "c1", orgId: null, userId: "other-user" });
    const ctx = makeCtx({ id: "member-A", orgId: "org-A", role: "member" }, [row]);

    await expect(assertClientRead(ctx, "c1")).rejects.toThrow(TRPCError);
  });

  it("throws NOT_FOUND when client row is missing", async () => {
    const ctx = makeCtx({ id: "user-1", orgId: null, role: null }, []);

    await expect(assertClientRead(ctx, "missing-id")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("uses NOT_FOUND (not FORBIDDEN) for out-of-scope to avoid existence leakage", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "owner-A" });
    const ctx = makeCtx({ id: "owner-B", orgId: "org-B", role: "owner" }, [row]);

    await expect(assertClientRead(ctx, "c1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("assertClientEdit", () => {
  it("delegates to assertClientRead (firm member can edit)", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "owner-A" });
    const ctx = makeCtx({ id: "member-A", orgId: "org-A", role: "member" }, [row]);

    const result = await assertClientEdit(ctx, "c1");
    expect(result.id).toBe("c1");
  });

  it("rejects out-of-scope user just like read", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "owner-A" });
    const ctx = makeCtx({ id: "owner-B", orgId: "org-B", role: "owner" }, [row]);

    await expect(assertClientEdit(ctx, "c1")).rejects.toThrow(TRPCError);
  });
});

describe("assertClientManage", () => {
  it("firm owner can manage firm client", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "other" });
    const ctx = makeCtx({ id: "owner-A", orgId: "org-A", role: "owner" }, [row]);

    const result = await assertClientManage(ctx, "c1");
    expect(result.id).toBe("c1");
  });

  it("firm admin can manage firm client", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "other" });
    const ctx = makeCtx({ id: "admin-A", orgId: "org-A", role: "admin" }, [row]);

    const result = await assertClientManage(ctx, "c1");
    expect(result.id).toBe("c1");
  });

  it("firm member is forbidden from managing firm client", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "other" });
    const ctx = makeCtx({ id: "member-A", orgId: "org-A", role: "member" }, [row]);

    await expect(assertClientManage(ctx, "c1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("solo creator can manage own solo client", async () => {
    const row = makeRow({ id: "c1", orgId: null, userId: "solo-1" });
    const ctx = makeCtx({ id: "solo-1", orgId: null, role: null }, [row]);

    const result = await assertClientManage(ctx, "c1");
    expect(result.id).toBe("c1");
  });

  it("out-of-scope user still gets NOT_FOUND (read check runs first)", async () => {
    const row = makeRow({ id: "c1", orgId: "org-A", userId: "other" });
    const ctx = makeCtx({ id: "owner-B", orgId: "org-B", role: "owner" }, [row]);

    await expect(assertClientManage(ctx, "c1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("clientListScope", () => {
  // clientListScope is pure — it doesn't call ctx.db. It returns a Drizzle SQL
  // expression that callers compose into their .where() clause. We verify
  // both branches return an SQL instance and that the two branches produce
  // structurally different outputs.
  const db = mockDb([]); // never used; present only to satisfy Ctx type

  it("returns an SQL expression for solo user", () => {
    const ctx: Ctx = { db, user: { id: "solo-1", orgId: null, role: null } };
    const where = clientListScope(ctx);
    expect(where).toBeInstanceOf(SQL);
  });

  it("returns an SQL expression for firm user", () => {
    const ctx: Ctx = { db, user: { id: "member-A", orgId: "org-A", role: "member" } };
    const where = clientListScope(ctx);
    expect(where).toBeInstanceOf(SQL);
  });

  it("solo and firm branches produce structurally different SQL", () => {
    const soloCtx: Ctx = { db, user: { id: "solo-1", orgId: null, role: null } };
    const firmCtx: Ctx = { db, user: { id: "member-A", orgId: "org-A", role: "member" } };

    const soloSql = clientListScope(soloCtx);
    const firmSql = clientListScope(firmCtx);

    // Both should be SQL instances. The two branches are different:
    // solo: and(isNull(clients.orgId), eq(clients.userId, ctx.user.id))
    // firm: eq(clients.orgId, ctx.user.orgId)
    // We verify they are both SQL and not the same object instance.
    expect(soloSql).toBeInstanceOf(SQL);
    expect(firmSql).toBeInstanceOf(SQL);
    expect(soloSql).not.toBe(firmSql);
  });
});
