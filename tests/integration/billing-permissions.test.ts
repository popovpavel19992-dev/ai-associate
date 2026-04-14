// tests/integration/billing-permissions.test.ts
//
// Unit tests for billing permission helpers (Phase 2.1.6).
// Uses a queue-draining mock db (no real DB access), matching the
// tests/integration/clients-router.test.ts pattern.

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import type { db as realDb } from "@/server/db";
import {
  assertTimeEntryAccess,
  assertTimeEntryEdit,
  assertExpenseAccess,
  assertExpenseEdit,
  assertInvoiceAccess,
  assertBillingRateManage,
} from "@/server/trpc/lib/permissions";
import type { timeEntries } from "@/server/db/schema/time-entries";
import type { expenses } from "@/server/db/schema/expenses";
import type { invoices } from "@/server/db/schema/invoices";

type TimeEntryRow = typeof timeEntries.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
type InvoiceRow = typeof invoices.$inferSelect;
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// ---------------------------------------------------------------------------
// Stable UUIDs
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  org: "33333333-3333-4333-a333-333333333333",
  entry: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  case1: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  invoice: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
  expense: "dddddddd-dddd-4ddd-dddd-dddddddddddd",
  member: "44444444-4444-4444-a444-444444444444",
  owner: "55555555-5555-4555-a555-555555555555",
  solo: "77777777-7777-4777-a777-777777777777",
  lineItem: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
};

// ---------------------------------------------------------------------------
// makeMockDb — queue-draining chainable mock supporting select + innerJoin
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      limit: () => chain,
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

  const db = {
    select: () => makeSelectChain(),
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
  };
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------
const makeEntry = (overrides: Partial<TimeEntryRow>): TimeEntryRow =>
  ({
    id: ID.entry,
    orgId: ID.org,
    userId: ID.user,
    caseId: ID.case1,
    taskId: null,
    activityType: "other",
    description: "Work",
    durationMinutes: 60,
    isBillable: true,
    rateCents: 30000,
    amountCents: 30000,
    entryDate: new Date("2026-04-01"),
    timerStartedAt: null,
    timerStoppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as TimeEntryRow;

const makeExpense = (overrides: Partial<ExpenseRow>): ExpenseRow =>
  ({
    id: ID.expense,
    orgId: ID.org,
    userId: ID.user,
    caseId: ID.case1,
    category: "other",
    description: "Expense",
    amountCents: 5000,
    expenseDate: new Date("2026-04-01"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ExpenseRow;

const makeInvoice = (overrides: Partial<InvoiceRow>): InvoiceRow =>
  ({
    id: ID.invoice,
    orgId: ID.org,
    userId: ID.owner,
    clientId: "ffffffff-ffff-4fff-afff-ffffffffffff",
    invoiceNumber: "INV-0001",
    status: "draft",
    issuedDate: null,
    dueDate: null,
    paidDate: null,
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    notes: null,
    paymentTerms: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as InvoiceRow;

// ---------------------------------------------------------------------------
// assertTimeEntryAccess
// ---------------------------------------------------------------------------
describe("assertTimeEntryAccess", () => {
  it("owner can access org entry: entry found + case access granted", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    // (1) fetch time entry, (2) assertCaseAccess for owner
    enqueueSelect([makeEntry({ userId: ID.member })]);
    enqueueSelect([{ id: ID.case1 }]); // case access check

    const entry = await assertTimeEntryAccess(ctx, ID.entry);
    expect(entry.id).toBe(ID.entry);
  });

  it("throws NOT_FOUND when entry does not exist", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([]); // no entry found

    await expect(assertTimeEntryAccess(ctx, ID.entry)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// assertTimeEntryEdit
// ---------------------------------------------------------------------------
describe("assertTimeEntryEdit", () => {
  it("member cannot edit another member's entry (FORBIDDEN)", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    // (1) fetch entry (owned by ID.user, not ID.member)
    enqueueSelect([makeEntry({ userId: ID.user })]);
    // (2) assertCaseAccess for member — must include case_members sub-query result too
    enqueueSelect([{ id: ID.case1 }]);

    await expect(assertTimeEntryEdit(ctx, ID.entry)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Can only edit your own time entries",
    });
  });

  it("member can edit their own entry when not invoiced", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    // (1) fetch entry (owned by ID.member)
    enqueueSelect([makeEntry({ userId: ID.member })]);
    // (2) assertCaseAccess
    enqueueSelect([{ id: ID.case1 }]);
    // (3) isEntryInvoiced → no line items
    enqueueSelect([]);

    const entry = await assertTimeEntryEdit(ctx, ID.entry);
    expect(entry.id).toBe(ID.entry);
  });

  it("throws FORBIDDEN when entry is already invoiced (non-draft)", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    // (1) fetch entry
    enqueueSelect([makeEntry({ userId: ID.owner })]);
    // (2) assertCaseAccess
    enqueueSelect([{ id: ID.case1 }]);
    // (3) isEntryInvoiced → found a line item on a non-draft invoice
    enqueueSelect([{ id: ID.lineItem }]);

    await expect(assertTimeEntryEdit(ctx, ID.entry)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Cannot modify invoiced entry",
    });
  });
});

// ---------------------------------------------------------------------------
// assertExpenseAccess
// ---------------------------------------------------------------------------
describe("assertExpenseAccess", () => {
  it("owner can access org expense", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([makeExpense({ userId: ID.member })]);
    enqueueSelect([{ id: ID.case1 }]);

    const expense = await assertExpenseAccess(ctx, ID.expense);
    expect(expense.id).toBe(ID.expense);
  });

  it("throws NOT_FOUND when expense does not exist", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([]);

    await expect(assertExpenseAccess(ctx, ID.expense)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// assertExpenseEdit
// ---------------------------------------------------------------------------
describe("assertExpenseEdit", () => {
  it("member cannot edit another member's expense (FORBIDDEN)", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    enqueueSelect([makeExpense({ userId: ID.user })]);
    enqueueSelect([{ id: ID.case1 }]);

    await expect(assertExpenseEdit(ctx, ID.expense)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Can only edit your own expenses",
    });
  });

  it("throws FORBIDDEN when expense is already invoiced", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([makeExpense({ userId: ID.owner })]);
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([{ id: ID.lineItem }]); // invoiced

    await expect(assertExpenseEdit(ctx, ID.expense)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Cannot modify invoiced expense",
    });
  });

  it("owner can edit own expense when not invoiced", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([makeExpense({ userId: ID.owner })]);
    enqueueSelect([{ id: ID.case1 }]);
    enqueueSelect([]); // not invoiced

    const expense = await assertExpenseEdit(ctx, ID.expense);
    expect(expense.id).toBe(ID.expense);
  });
});

// ---------------------------------------------------------------------------
// assertInvoiceAccess
// ---------------------------------------------------------------------------
describe("assertInvoiceAccess", () => {
  it("org owner can access own org invoice", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([makeInvoice({ orgId: ID.org, status: "sent" })]);

    const invoice = await assertInvoiceAccess(ctx, ID.invoice);
    expect(invoice.id).toBe(ID.invoice);
  });

  it("org admin can access invoice", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "admin" } };

    enqueueSelect([makeInvoice({ orgId: ID.org })]);

    const invoice = await assertInvoiceAccess(ctx, ID.invoice);
    expect(invoice.id).toBe(ID.invoice);
  });

  it("org member is FORBIDDEN from accessing invoice", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };

    enqueueSelect([makeInvoice({ orgId: ID.org })]);

    await expect(assertInvoiceAccess(ctx, ID.invoice)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("solo user can access their own invoice", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };

    enqueueSelect([makeInvoice({ orgId: null, userId: ID.solo })]);

    const invoice = await assertInvoiceAccess(ctx, ID.invoice);
    expect(invoice.id).toBe(ID.invoice);
  });

  it("solo user cannot access another user's invoice (NOT_FOUND)", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };

    enqueueSelect([makeInvoice({ orgId: null, userId: ID.user })]);

    await expect(assertInvoiceAccess(ctx, ID.invoice)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND when invoice does not exist", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };

    enqueueSelect([]);

    await expect(assertInvoiceAccess(ctx, ID.invoice)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// assertBillingRateManage
// ---------------------------------------------------------------------------
describe("assertBillingRateManage", () => {
  it("org owner can manage billing rates", () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "owner" } };
    expect(() => assertBillingRateManage(ctx)).not.toThrow();
  });

  it("org admin can manage billing rates", () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.owner, orgId: ID.org, role: "admin" } };
    expect(() => assertBillingRateManage(ctx)).not.toThrow();
  });

  it("org member is FORBIDDEN from managing billing rates", () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.member, orgId: ID.org, role: "member" } };
    expect(() => assertBillingRateManage(ctx)).toThrow(TRPCError);
  });

  it("solo user can manage their own billing rates (no org check)", () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.solo, orgId: null, role: null } };
    expect(() => assertBillingRateManage(ctx)).not.toThrow();
  });
});
