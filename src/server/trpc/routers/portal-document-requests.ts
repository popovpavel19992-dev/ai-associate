// src/server/trpc/routers/portal-document-requests.ts
//
// Portal-side tRPC sub-router for documentRequests (Phase 2.3.2 Task 9).
// Allows portal users (clients) to list, view, and attach uploaded files
// to document request items for cases they have access to.

import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { DocumentRequestsService } from "@/server/services/document-requests/service";
import { documents } from "@/server/db/schema/documents";
import { cases } from "@/server/db/schema/cases";

async function assertPortalCaseAccess(
  ctx: { db: typeof import("@/server/db").db; portalUser: { clientId: string } },
  caseId: string,
): Promise<void> {
  const [caseRow] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.clientId, ctx.portalUser.clientId)))
    .limit(1);
  if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
}

export const portalDocumentRequestsRouter = router({
  list: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPortalCaseAccess(ctx, input.caseId);
      const svc = new DocumentRequestsService({ db: ctx.db });
      const { requests } = await svc.listForCase({ caseId: input.caseId });
      return { requests: requests.filter((r) => r.status !== "cancelled") };
    }),

  get: portalProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new DocumentRequestsService({ db: ctx.db });
      const { request, items } = await svc.getRequest({ requestId: input.requestId });
      await assertPortalCaseAccess(ctx, request.caseId);
      const files = await Promise.all(
        items.map(async (it) => ({ itemId: it.id, files: await svc.listItemFiles({ itemId: it.id }) })),
      );
      return { request, items, files };
    }),

  attachUploaded: portalProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      documentId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select({ id: documents.id, caseId: documents.caseId })
        .from(documents)
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc || !doc.caseId) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      await assertPortalCaseAccess(ctx, doc.caseId);
      const svc = new DocumentRequestsService({ db: ctx.db });
      return svc.uploadItemFile({
        itemId: input.itemId,
        documentId: input.documentId,
        uploadedByPortalUserId: ctx.portalUser.id,
      });
    }),

  replaceAttached: portalProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      oldJoinId: z.string().uuid(),
      newDocumentId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select({ id: documents.id, caseId: documents.caseId })
        .from(documents)
        .where(eq(documents.id, input.newDocumentId))
        .limit(1);
      if (!doc || !doc.caseId) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      await assertPortalCaseAccess(ctx, doc.caseId);
      const svc = new DocumentRequestsService({ db: ctx.db });
      return svc.replaceItemFile({
        itemId: input.itemId,
        oldJoinId: input.oldJoinId,
        newDocumentId: input.newDocumentId,
        uploadedByPortalUserId: ctx.portalUser.id,
      });
    }),
});
