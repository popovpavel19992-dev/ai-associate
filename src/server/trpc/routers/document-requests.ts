// src/server/trpc/routers/document-requests.ts
//
// tRPC sub-router for documentRequests.* procedures (Phase 2.3.2 Task 8).
// Lawyer-side procedures for creating, editing, cancelling document requests
// and reviewing/rejecting submitted items.

import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { DocumentRequestsService } from "@/server/services/document-requests/service";
import { documentRequests } from "@/server/db/schema/document-requests";
import { cases } from "@/server/db/schema/cases";

const itemInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export const documentRequestsRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new DocumentRequestsService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId });
    }),

  get: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      const { request, items } = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, request.caseId);
      const files = await Promise.all(
        items.map(async (it) => ({ itemId: it.id, files: await svc.listItemFiles({ itemId: it.id }) })),
      );
      return { request, items, files };
    }),

  create: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      note: z.string().max(5000).optional(),
      dueAt: z.date().optional(),
      items: z.array(itemInput).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new DocumentRequestsService({ db: ctx.db });
      return svc.createRequest({ ...input, createdBy: ctx.user.id });
    }),

  updateMeta: protectedProcedure
    .input(z.object({
      requestId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      note: z.string().max(5000).nullable().optional(),
      dueAt: z.date().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      const { request } = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, request.caseId);
      await svc.updateMeta(input);
      return { ok: true as const };
    }),

  cancel: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      const { request } = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, request.caseId);
      await svc.cancelRequest({ requestId: input.requestId, cancelledBy: ctx.user.id });
      return { ok: true as const };
    }),

  addItem: protectedProcedure
    .input(z.object({
      requestId: z.string().uuid(),
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      const { request } = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, request.caseId);
      return svc.addItem(input);
    }),

  updateItem: protectedProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      await svc.updateItem(input);
      return { ok: true as const };
    }),

  removeItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      await svc.removeItem(input);
      return { ok: true as const };
    }),

  reviewItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      await svc.reviewItem(input);
      return { ok: true as const };
    }),

  rejectItem: protectedProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      rejectionNote: z.string().trim().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      await svc.rejectItem(input);
      return { ok: true as const };
    }),

  pendingReviewCount: protectedProcedure.query(async ({ ctx }) => {
    const orgClause = ctx.user.orgId
      ? sql`${cases.orgId} = ${ctx.user.orgId}`
      : sql`${cases.userId} = ${ctx.user.id}`;
    const rows = await ctx.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${documentRequests} dr
      JOIN ${cases} c ON c.id = dr.case_id
      WHERE ${orgClause} AND dr.status = 'awaiting_review'
    `);
    const list = ((rows as any).rows ?? rows) as Array<{ count: number }>;
    return { count: Number(list[0]?.count ?? 0) };
  }),
});
