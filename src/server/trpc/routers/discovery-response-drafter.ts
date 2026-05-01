import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { incomingDiscoveryRequests } from "@/server/db/schema/incoming-discovery-requests";
import { ourDiscoveryResponseDrafts } from "@/server/db/schema/our-discovery-response-drafts";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import {
  DraftsExistError,
  InsufficientCreditsError,
  RequestServedError,
  draftBatch,
  draftSingle,
  parseAndSave,
} from "@/server/services/discovery-response/orchestrator";
import { buildDiscoveryResponseDocx } from "@/server/services/discovery-response/docx";
import type { OurResponseType } from "@/server/db/schema/our-discovery-response-drafts";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Discovery response drafter not enabled for this organization.",
    });
  }
}

const requestTypeEnum = z.enum(["interrogatories", "rfp", "rfa"]);
const responseTypeEnum = z.enum([
  "admit",
  "deny",
  "object",
  "lack_of_knowledge",
  "written_response",
  "produced_documents",
]);

export const discoveryResponseDrafterRouter = router({
  parseAndSave: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        requestType: requestTypeEnum,
        setNumber: z.number().int().min(1).max(99),
        servingParty: z.string().min(1).max(200),
        dueAt: z.string().datetime().optional(),
        source: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("paste"), text: z.string().min(1) }),
          z.object({ mode: z.literal("document"), documentId: z.string().uuid() }),
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      if (!ctx.user.orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Org required" });
      }
      await assertCaseAccess(ctx, input.caseId);
      try {
        return await parseAndSave({
          caseId: input.caseId,
          orgId: ctx.user.orgId,
          userId: ctx.user.id,
          meta: {
            requestType: input.requestType,
            setNumber: input.setNumber,
            servingParty: input.servingParty,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
          },
          source: input.source,
        });
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: "Insufficient credits.",
          });
        }
        if (
          e instanceof Error &&
          (e as { code?: string }).code === "EXTRACT_PENDING"
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: e.message,
          });
        }
        throw e;
      }
    }),

  listIncoming: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      return ctx.db
        .select()
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.caseId, input.caseId))
        .orderBy(incomingDiscoveryRequests.receivedAt);
    }),

  getIncoming: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select()
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }
      await assertCaseAccess(ctx, req.caseId);

      const drafts = await ctx.db
        .select()
        .from(ourDiscoveryResponseDrafts)
        .where(eq(ourDiscoveryResponseDrafts.requestId, input.requestId))
        .orderBy(ourDiscoveryResponseDrafts.questionIndex);

      return { request: req, drafts };
    }),

  draftBatch: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select({ caseId: incomingDiscoveryRequests.caseId })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }
      await assertCaseAccess(ctx, req.caseId);
      try {
        return await draftBatch({
          requestId: input.requestId,
          userId: ctx.user.id,
        });
      } catch (e) {
        if (e instanceof DraftsExistError) {
          throw new TRPCError({ code: "CONFLICT", message: e.message });
        }
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: "Insufficient credits.",
          });
        }
        throw e;
      }
    }),

  draftSingle: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        questionIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select({ caseId: incomingDiscoveryRequests.caseId })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }
      await assertCaseAccess(ctx, req.caseId);
      try {
        return await draftSingle({
          requestId: input.requestId,
          questionIndex: input.questionIndex,
          userId: ctx.user.id,
        });
      } catch (e) {
        if (e instanceof RequestServedError) {
          throw new TRPCError({ code: "FORBIDDEN", message: e.message });
        }
        if (e instanceof InsufficientCreditsError) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: "Insufficient credits.",
          });
        }
        throw e;
      }
    }),

  updateDraft: protectedProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        responseType: responseTypeEnum,
        responseText: z.string().nullable(),
        objectionBasis: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [d] = await ctx.db
        .select({ requestId: ourDiscoveryResponseDrafts.requestId })
        .from(ourDiscoveryResponseDrafts)
        .where(eq(ourDiscoveryResponseDrafts.id, input.draftId))
        .limit(1);
      if (!d) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      }
      const [req] = await ctx.db
        .select({
          caseId: incomingDiscoveryRequests.caseId,
          status: incomingDiscoveryRequests.status,
        })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, d.requestId))
        .limit(1);
      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }
      await assertCaseAccess(ctx, req.caseId);
      if (req.status === "served") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Request is served and locked",
        });
      }

      await ctx.db
        .update(ourDiscoveryResponseDrafts)
        .set({
          responseType: input.responseType as OurResponseType,
          responseText: input.responseText,
          objectionBasis: input.objectionBasis,
          aiGenerated: false,
          updatedAt: new Date(),
        })
        .where(eq(ourDiscoveryResponseDrafts.id, input.draftId));
      return { success: true };
    }),

  markServed: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select({ caseId: incomingDiscoveryRequests.caseId })
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }
      await assertCaseAccess(ctx, req.caseId);
      await ctx.db
        .update(incomingDiscoveryRequests)
        .set({ status: "served", servedAt: new Date(), updatedAt: new Date() })
        .where(eq(incomingDiscoveryRequests.id, input.requestId));
      return { success: true };
    }),

  exportDocx: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      const [req] = await ctx.db
        .select()
        .from(incomingDiscoveryRequests)
        .where(eq(incomingDiscoveryRequests.id, input.requestId))
        .limit(1);
      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      }
      await assertCaseAccess(ctx, req.caseId);

      const drafts = await ctx.db
        .select()
        .from(ourDiscoveryResponseDrafts)
        .where(eq(ourDiscoveryResponseDrafts.requestId, input.requestId))
        .orderBy(ourDiscoveryResponseDrafts.questionIndex);

      const { cases } = await import("@/server/db/schema/cases");
      const [c] = await ctx.db
        .select()
        .from(cases)
        .where(eq(cases.id, req.caseId))
        .limit(1);

      const buf = await buildDiscoveryResponseDocx(
        {
          requestType: req.requestType as "interrogatories" | "rfp" | "rfa",
          setNumber: req.setNumber,
          servingParty: req.servingParty,
          questions: req.questions as Array<{
            number: number;
            text: string;
            subparts?: string[];
          }>,
        },
        drafts.map((d) => ({
          questionIndex: d.questionIndex,
          responseType: d.responseType,
          responseText: d.responseText,
          objectionBasis: d.objectionBasis,
        })),
        {
          plaintiff: c?.plaintiffName ?? "Plaintiff",
          defendant: c?.defendantName ?? "Defendant",
          caseNumber: c?.caseNumber ?? "",
          court: c?.court ?? "U.S. District Court",
        },
      );
      return { base64: buf.toString("base64") };
    }),
});
