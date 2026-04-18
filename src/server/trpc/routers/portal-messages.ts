import { z } from "zod/v4";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { caseMessages } from "@/server/db/schema/case-messages";
import { cases } from "@/server/db/schema/cases";
import { inngest } from "@/server/inngest/client";

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

export const portalMessagesRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      cursor: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(30),
    }))
    .query(async ({ ctx, input }) => {
      // Verify case ownership + messages visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      const vis = caseRow.portalVisibility as Record<string, boolean> | null;
      if (!vis || vis.messages === false) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Messages not available" });
      }

      const conditions = [
        eq(caseMessages.caseId, input.caseId),
        isNull(caseMessages.deletedAt),
      ];

      if (input.cursor) {
        const [cursorRow] = await ctx.db
          .select({ createdAt: caseMessages.createdAt })
          .from(caseMessages)
          .where(eq(caseMessages.id, input.cursor))
          .limit(1);
        if (cursorRow) {
          conditions.push(sql`${caseMessages.createdAt} < ${cursorRow.createdAt}`);
        }
      }

      const rows = await ctx.db
        .select({
          id: caseMessages.id,
          authorType: caseMessages.authorType,
          lawyerAuthorId: caseMessages.lawyerAuthorId,
          portalAuthorId: caseMessages.portalAuthorId,
          body: caseMessages.body,
          createdAt: caseMessages.createdAt,
        })
        .from(caseMessages)
        .where(and(...conditions))
        .orderBy(desc(caseMessages.createdAt))
        .limit(input.limit + 1);

      return {
        messages: rows.slice(0, input.limit),
        nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : undefined,
      };
    }),

  send: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      body: z.string().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify case ownership + messages visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });

      const sanitizedBody = stripHtml(input.body);

      const [message] = await ctx.db
        .insert(caseMessages)
        .values({
          caseId: input.caseId,
          authorType: "client",
          portalAuthorId: ctx.portalUser.id,
          body: sanitizedBody,
        })
        .returning();

      // Notify lawyer about client message
      const [caseInfo] = await ctx.db
        .select({ name: cases.name, userId: cases.userId, orgId: cases.orgId })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      if (caseInfo) {
        await inngest.send({
          name: "notification/send",
          data: {
            type: "portal_message_received",
            title: "New message from client",
            body: `${ctx.portalUser.displayName} sent a message in ${caseInfo.name}`,
            userId: caseInfo.userId,
            orgId: caseInfo.orgId ?? undefined,
            caseId: input.caseId,
            actionUrl: `/cases/${input.caseId}`,
            metadata: { caseName: caseInfo.name, clientName: ctx.portalUser.displayName, messagePreview: sanitizedBody.slice(0, 100) },
          },
        });
      }

      return message;
    }),
});
