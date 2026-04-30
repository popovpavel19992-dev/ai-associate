// src/server/trpc/routers/court-rules.ts
//
// Phase 3.13 — Court Rules Quick Reference tRPC surface.
// Mounted at appRouter.courtRules.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { cases } from "@/server/db/schema/cases";
import {
  COURT_RULE_CATEGORIES,
  type CourtRuleCategory,
} from "@/server/db/schema/court-rules";
import * as svc from "@/server/services/court-rules/service";
import {
  applyRuleToCase,
  explainRulePlainEnglish,
} from "@/server/services/court-rules/ai-explain";

const categorySchema = z.enum([...COURT_RULE_CATEGORIES] as [CourtRuleCategory, ...CourtRuleCategory[]]);

export const courtRulesRouter = router({
  search: protectedProcedure
    .input(
      z.object({
        text: z.string().trim().max(200).optional(),
        jurisdiction: z.array(z.string().trim().min(1).max(40)).optional(),
        category: z.array(categorySchema).optional(),
        onlyBookmarks: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const results = await svc.searchRules(
        ctx.db,
        {
          text: input.text,
          jurisdiction: input.jurisdiction,
          category: input.category,
          bookmarkedBy: input.onlyBookmarks ? ctx.user.id : undefined,
          limit: input.limit,
          offset: input.offset,
        },
        ctx.user.id,
      );
      return { rules: results };
    }),

  get: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const out = await svc.getRule(ctx.db, input.ruleId, ctx.user.id);
      if (!out) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      return out;
    }),

  bookmark: protectedProcedure
    .input(
      z.object({
        ruleId: z.string().uuid(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return svc.addBookmark(ctx.db, ctx.user.id, input.ruleId, input.notes ?? null);
    }),

  removeBookmark: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await svc.removeBookmark(ctx.db, ctx.user.id, input.ruleId);
      return { ok: true as const };
    }),

  listBookmarks: protectedProcedure.query(async ({ ctx }) => {
    return svc.listBookmarks(ctx.db, ctx.user.id);
  }),

  listJurisdictions: protectedProcedure.query(async ({ ctx }) => {
    return svc.listJurisdictions(ctx.db);
  }),

  explain: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const out = await svc.getRule(ctx.db, input.ruleId, ctx.user.id);
      if (!out) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      try {
        const text = await explainRulePlainEnglish({
          ruleTitle: out.rule.title,
          ruleBody: out.rule.body,
          citation: out.rule.citationShort,
        });
        return { explanation: text };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI explanation failed";
        if (msg.includes("ANTHROPIC_API_KEY")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  applyToCase: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid(), caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const out = await svc.getRule(ctx.db, input.ruleId, ctx.user.id);
      if (!out) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });

      const [caseRow] = await ctx.db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

      const caseType = caseRow.overrideCaseType ?? caseRow.detectedCaseType ?? "general";
      const jurisdiction = caseRow.jurisdictionOverride ?? out.rule.jurisdiction;

      try {
        const text = await applyRuleToCase({
          ruleTitle: out.rule.title,
          ruleBody: out.rule.body,
          citation: out.rule.citationShort,
          caseFacts: caseRow.description ?? "",
          caseType,
          jurisdiction,
        });
        return { application: text, caseId: caseRow.id, caseName: caseRow.name };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI application failed";
        if (msg.includes("ANTHROPIC_API_KEY")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  myCases: protectedProcedure.query(async ({ ctx }) => {
    // Lightweight list of user's accessible cases for the "Apply to a case" picker.
    // Permissions are reaffirmed per-case in applyToCase via assertCaseAccess.
    const rows = await ctx.db
      .select({
        id: cases.id,
        name: cases.name,
        status: cases.status,
        caseType: cases.detectedCaseType,
      })
      .from(cases)
      .where(eq(cases.userId, ctx.user.id))
      .limit(100);
    return rows;
  }),
});
