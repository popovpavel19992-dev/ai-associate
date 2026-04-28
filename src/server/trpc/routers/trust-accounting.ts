// src/server/trpc/routers/trust-accounting.ts
//
// Phase 3.8 — Trust Accounting / IOLTA tRPC router.
// Owner/admin-only access throughout. The procedure-level guard is
// `requireOwnerOrAdmin` — members cannot read or write trust data.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import * as accountsService from "@/server/services/trust-accounting/accounts-service";
import * as txnService from "@/server/services/trust-accounting/transactions-service";
import * as balancesService from "@/server/services/trust-accounting/balances-service";
import * as reconService from "@/server/services/trust-accounting/reconciliation-service";

function requireOwnerOrAdmin(ctx: {
  user: { orgId: string | null; role: string | null };
}): string {
  if (!ctx.user.orgId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  }
  if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Trust accounting is restricted to firm owners and admins.",
    });
  }
  return ctx.user.orgId;
}

const ACCOUNT_TYPE = z.enum(["iolta", "operating"]);

const accountsRouter = router({
  list: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      return accountsService.listAccounts(ctx.db, orgId, {
        includeInactive: input?.includeInactive,
      });
    }),

  get: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      const acc = await accountsService.getAccount(ctx.db, orgId, input.accountId);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      return acc;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        accountType: ACCOUNT_TYPE,
        bankName: z.string().max(200).nullish(),
        accountNumber: z.string().max(60).nullish(),
        routingNumber: z.string().max(20).nullish(),
        jurisdiction: z.string().max(20).optional(),
        beginningBalanceCents: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      return accountsService.createAccount(ctx.db, {
        orgId,
        name: input.name,
        accountType: input.accountType,
        bankName: input.bankName ?? null,
        accountNumber: input.accountNumber ?? null,
        routingNumber: input.routingNumber ?? null,
        jurisdiction: input.jurisdiction,
        beginningBalanceCents: input.beginningBalanceCents,
        createdBy: ctx.user.id,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        jurisdiction: z.string().max(20).optional(),
        bankName: z.string().max(200).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      await accountsService.updateAccount(ctx.db, orgId, input.accountId, {
        name: input.name,
        jurisdiction: input.jurisdiction,
        bankName: input.bankName ?? undefined,
      });
      return { ok: true as const };
    }),

  archive: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      await accountsService.archiveAccount(ctx.db, orgId, input.accountId);
      return { ok: true as const };
    }),
});

const TXN_DATE = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

const transactionsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
        startDate: TXN_DATE.optional(),
        endDate: TXN_DATE.optional(),
        includeVoided: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      return txnService.listTransactions(
        ctx.db,
        { orgId, accountId: input.accountId },
        {
          clientId: input.clientId,
          caseId: input.caseId,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          includeVoided: input.includeVoided,
        },
      );
    }),

  recordDeposit: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        clientId: z.string().uuid().nullish(),
        caseId: z.string().uuid().nullish(),
        amountCents: z.number().int().positive(),
        transactionDate: TXN_DATE,
        payorName: z.string().max(200).nullish(),
        description: z.string().min(1).max(500),
        checkNumber: z.string().max(50).nullish(),
        wireReference: z.string().max(100).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      return txnService.recordDeposit(ctx.db, {
        orgId,
        accountId: input.accountId,
        clientId: input.clientId ?? null,
        caseId: input.caseId ?? null,
        amountCents: input.amountCents,
        transactionDate: new Date(input.transactionDate),
        payorName: input.payorName ?? null,
        description: input.description,
        checkNumber: input.checkNumber ?? null,
        wireReference: input.wireReference ?? null,
        createdBy: ctx.user.id,
      });
    }),

  recordDisbursement: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        clientId: z.string().uuid(),
        caseId: z.string().uuid().nullish(),
        amountCents: z.number().int().positive(),
        transactionDate: TXN_DATE,
        payeeName: z.string().min(1).max(200),
        description: z.string().min(1).max(500),
        checkNumber: z.string().max(50).nullish(),
        wireReference: z.string().max(100).nullish(),
        authorizedBy: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      try {
        return await txnService.recordDisbursement(ctx.db, {
          orgId,
          accountId: input.accountId,
          clientId: input.clientId,
          caseId: input.caseId ?? null,
          amountCents: input.amountCents,
          transactionDate: new Date(input.transactionDate),
          payeeName: input.payeeName,
          description: input.description,
          checkNumber: input.checkNumber ?? null,
          wireReference: input.wireReference ?? null,
          authorizedBy: input.authorizedBy ?? ctx.user.id,
          createdBy: ctx.user.id,
        });
      } catch (e) {
        if (e instanceof txnService.NeverNegativeError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Disbursement blocked — would drive client below zero. Current balance: ${(
              e.currentBalanceCents / 100
            ).toFixed(2)} USD`,
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Disbursement failed",
        });
      }
    }),

  recordTransfer: protectedProcedure
    .input(
      z.object({
        fromAccountId: z.string().uuid(),
        toAccountId: z.string().uuid(),
        clientId: z.string().uuid(),
        caseId: z.string().uuid().nullish(),
        amountCents: z.number().int().positive(),
        transactionDate: TXN_DATE,
        description: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      try {
        return await txnService.recordTransfer(ctx.db, {
          orgId,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          clientId: input.clientId,
          caseId: input.caseId ?? null,
          amountCents: input.amountCents,
          transactionDate: new Date(input.transactionDate),
          description: input.description,
          authorizedBy: ctx.user.id,
          createdBy: ctx.user.id,
        });
      } catch (e) {
        if (e instanceof txnService.NeverNegativeError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Transfer blocked — would drive client below zero. Current balance: ${(
              e.currentBalanceCents / 100
            ).toFixed(2)} USD`,
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Transfer failed",
        });
      }
    }),

  void: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().uuid(),
        reason: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      try {
        return await txnService.voidTransaction(ctx.db, {
          orgId,
          transactionId: input.transactionId,
          reason: input.reason,
          voidedBy: ctx.user.id,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Void failed",
        });
      }
    }),
});

const balancesRouter = router({
  getAccount: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireOwnerOrAdmin(ctx);
      return balancesService.getAccountBalance(ctx.db, input.accountId);
    }),

  getClient: protectedProcedure
    .input(z.object({ accountId: z.string().uuid(), clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireOwnerOrAdmin(ctx);
      return balancesService.getClientBalance(ctx.db, input.accountId, input.clientId);
    }),

  getAllClients: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireOwnerOrAdmin(ctx);
      return balancesService.getAllClientBalances(ctx.db, input.accountId);
    }),
});

const reconciliationRouter = router({
  list: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireOwnerOrAdmin(ctx);
      return reconService.listReconciliations(ctx.db, input.accountId);
    }),

  get: protectedProcedure
    .input(z.object({ reconciliationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireOwnerOrAdmin(ctx);
      const row = await reconService.getReconciliation(ctx.db, input.reconciliationId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Reconciliation not found" });
      return row;
    }),

  preview: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        periodMonth: TXN_DATE,
        bankStatementBalanceCents: z.number().int().min(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOwnerOrAdmin(ctx);
      return reconService.previewReconciliation(ctx.db, {
        accountId: input.accountId,
        periodMonth: new Date(input.periodMonth),
        bankStatementBalanceCents: input.bankStatementBalanceCents,
      });
    }),

  record: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        periodMonth: TXN_DATE,
        bankStatementBalanceCents: z.number().int().min(0),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOwnerOrAdmin(ctx);
      try {
        return await reconService.recordReconciliation(ctx.db, {
          orgId,
          accountId: input.accountId,
          periodMonth: new Date(input.periodMonth),
          bankStatementBalanceCents: input.bankStatementBalanceCents,
          reconciledBy: ctx.user.id,
          notes: input.notes ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Reconciliation failed",
        });
      }
    }),
});

export const trustAccountingRouter = router({
  accounts: accountsRouter,
  transactions: transactionsRouter,
  balances: balancesRouter,
  reconciliation: reconciliationRouter,
});
