// src/server/trpc/routers/case-messages.ts
//
// tRPC sub-router for caseMessages.* procedures (Phase 2.3.1 Task 5).
// Procedures: list, send, markRead, unreadByCase, attachableDocuments, onNewMessage (SSE).

import { z } from "zod/v4";
import { and, desc, eq, ilike } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { caseMessages } from "@/server/db/schema/case-messages";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { portalUsers } from "@/server/db/schema/portal-users";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { CaseMessagesService } from "@/server/services/messaging/case-messages-service";
import { messagingPubsub } from "@/server/services/messaging/pubsub";

export const caseMessagesRouter = router({
  /**
   * list — paginated messages for a case, joined with author names + document filename.
   * Ordered newest-first.
   */
  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        page: z.number().int().min(1).max(100).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const offset = (input.page - 1) * input.pageSize;
      const rows = await ctx.db
        .select({
          id: caseMessages.id,
          caseId: caseMessages.caseId,
          authorType: caseMessages.authorType,
          lawyerAuthorId: caseMessages.lawyerAuthorId,
          portalAuthorId: caseMessages.portalAuthorId,
          body: caseMessages.body,
          documentId: caseMessages.documentId,
          createdAt: caseMessages.createdAt,
          lawyerName: users.name,
          portalName: portalUsers.displayName,
          documentName: documents.filename,
        })
        .from(caseMessages)
        .leftJoin(users, eq(users.id, caseMessages.lawyerAuthorId))
        .leftJoin(portalUsers, eq(portalUsers.id, caseMessages.portalAuthorId))
        .leftJoin(documents, eq(documents.id, caseMessages.documentId))
        .where(eq(caseMessages.caseId, input.caseId))
        .orderBy(desc(caseMessages.createdAt))
        .limit(input.pageSize)
        .offset(offset);
      return { messages: rows, page: input.page, pageSize: input.pageSize };
    }),

  /**
   * send — insert a lawyer message, delegate to CaseMessagesService for Inngest dispatch.
   */
  send: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        body: z.string().trim().min(1).max(5000),
        documentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMessagesService({ db: ctx.db });
      return svc.send({
        caseId: input.caseId,
        lawyerUserId: ctx.user.id,
        body: input.body,
        documentId: input.documentId,
      });
    }),

  /**
   * markRead — UPSERT a case_message_reads row for the current user + case.
   */
  markRead: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new CaseMessagesService({ db: ctx.db });
      await svc.markRead({ caseId: input.caseId, userId: ctx.user.id });
      return { ok: true as const };
    }),

  /**
   * unreadByCase — returns unread client-message counts per case for sidebar badge.
   */
  unreadByCase: protectedProcedure.query(async ({ ctx }) => {
    const svc = new CaseMessagesService({ db: ctx.db });
    return svc.unreadByCase({ userId: ctx.user.id, orgId: ctx.user.orgId ?? null });
  }),

  /**
   * attachableDocuments — list documents in a case, with optional ilike filename search.
   */
  attachableDocuments: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        search: z.string().trim().max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const conditions: ReturnType<typeof eq>[] = [eq(documents.caseId, input.caseId)];
      if (input.search) {
        conditions.push(ilike(documents.filename, `%${input.search}%`) as ReturnType<typeof eq>);
      }
      const rows = await ctx.db
        .select({
          id: documents.id,
          filename: documents.filename,
          fileType: documents.fileType,
          fileSize: documents.fileSize,
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.id))
        .limit(50);
      return { documents: rows };
    }),

  /**
   * onNewMessage — SSE subscription; yields new messages as they arrive via in-process pubsub.
   * Uses async generator pattern (tRPC v11). Cleanup via `finally` block.
   */
  onNewMessage: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await assertCaseAccess(ctx, input.caseId);

      const queue: unknown[] = [];
      let waker: (() => void) | null = null;

      const unsub = messagingPubsub.on(`case:${input.caseId}`, (msg) => {
        queue.push(msg);
        waker?.();
      });

      try {
        while (!signal?.aborted) {
          if (queue.length > 0) {
            yield { type: "new" as const, message: queue.shift() };
          } else {
            await new Promise<void>((resolve) => {
              waker = resolve;
              const timeout = setTimeout(resolve, 30_000);
              if (signal) {
                signal.addEventListener("abort", () => {
                  clearTimeout(timeout);
                  resolve();
                });
              }
            });
            waker = null;
          }
        }
      } finally {
        unsub();
      }
    }),
});
