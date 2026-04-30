// src/server/trpc/routers/out-of-office.ts
//
// Phase 3.14 — Out-of-Office tRPC surface. Mounted at appRouter.outOfOffice.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { users } from "@/server/db/schema/users";
import * as svc from "@/server/services/out-of-office/service";
import {
  DEFAULT_AUTO_RESPONSE_BODY,
  renderTemplate,
} from "@/server/services/out-of-office/auto-responder";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const outOfOfficeRouter = router({
  list: protectedProcedure
    .input(z.object({ includeEnded: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await svc.listForUser(ctx.db, ctx.user.id, {
        includeEnded: input?.includeEnded ?? true,
      });
      return rows;
    }),

  getActive: protectedProcedure.query(async ({ ctx }) => {
    return svc.getActiveForUser(ctx.db, ctx.user.id, new Date());
  }),

  getActiveForOrg: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.orgId) return [];
    const active = await svc.getActiveForOrg(ctx.db, ctx.user.orgId, new Date());
    if (active.length === 0) return [];

    const ids = Array.from(
      new Set(active.flatMap((a) => [a.userId, a.coverageUserId].filter(Boolean) as string[])),
    );
    const userRows = ids.length
      ? await ctx.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, ids))
      : [];
    const byId = new Map(userRows.map((u) => [u.id, u]));

    return active.map((a) => ({
      oooId: a.oooId,
      userId: a.userId,
      userName: byId.get(a.userId)?.name ?? "",
      userEmail: byId.get(a.userId)?.email ?? "",
      startDate: a.startDate,
      endDate: a.endDate,
      coverageUserId: a.coverageUserId,
      coverageName: a.coverageUserId
        ? byId.get(a.coverageUserId)?.name ?? null
        : null,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        startDate: dateString,
        endDate: dateString,
        autoResponseSubject: z.string().trim().min(1).max(200).optional(),
        autoResponseBody: z.string().trim().min(1).max(5000),
        coverageUserId: z.string().uuid().nullable().optional(),
        emergencyKeywordResponse: z.string().trim().max(5000).nullable().optional(),
        includeInSignature: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.endDate < input.startDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End date must be on or after start date.",
        });
      }
      // If coverage user specified, verify same org.
      if (input.coverageUserId) {
        const [coverage] = await ctx.db
          .select({ id: users.id, orgId: users.orgId })
          .from(users)
          .where(eq(users.id, input.coverageUserId))
          .limit(1);
        if (!coverage || coverage.orgId !== ctx.user.orgId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Coverage attorney must be a member of your organization.",
          });
        }
      }
      return svc.createOoo(ctx.db, {
        userId: ctx.user.id,
        orgId: ctx.user.orgId,
        startDate: input.startDate,
        endDate: input.endDate,
        autoResponseSubject: input.autoResponseSubject,
        autoResponseBody: input.autoResponseBody,
        coverageUserId: input.coverageUserId ?? null,
        emergencyKeywordResponse: input.emergencyKeywordResponse ?? null,
        includeInSignature: input.includeInSignature ?? true,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        oooId: z.string().uuid(),
        startDate: dateString.optional(),
        endDate: dateString.optional(),
        autoResponseSubject: z.string().trim().min(1).max(200).optional(),
        autoResponseBody: z.string().trim().min(1).max(5000).optional(),
        coverageUserId: z.string().uuid().nullable().optional(),
        emergencyKeywordResponse: z.string().trim().max(5000).nullable().optional(),
        includeInSignature: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { oooId, ...patch } = input;
      const row = await svc.updateOoo(ctx.db, oooId, ctx.user.id, patch);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "OOO period not found or already ended.",
        });
      }
      return row;
    }),

  cancel: protectedProcedure
    .input(z.object({ oooId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await svc.cancelOoo(ctx.db, input.oooId, ctx.user.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "OOO period not found." });
      }
      return row;
    }),

  previewMessage: protectedProcedure
    .input(
      z.object({
        body: z.string().min(1).max(5000),
        endDate: dateString,
        coverageUserId: z.string().uuid().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let coverageName = "our office";
      let coverageEmail = "";
      if (input.coverageUserId) {
        const [coverage] = await ctx.db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, input.coverageUserId))
          .limit(1);
        if (coverage) {
          coverageName = coverage.name;
          coverageEmail = coverage.email;
        }
      }
      const returnDate = new Date(`${input.endDate}T00:00:00Z`).toLocaleDateString(
        "en-US",
        { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
      );
      const rendered = renderTemplate(input.body, {
        returnDate,
        coverageName,
        coverageEmail,
        firmPhone: process.env.FIRM_PHONE ?? "",
        senderName: "Sample Sender",
        senderEmail: "sender@example.com",
      });
      return { rendered };
    }),

  defaults: protectedProcedure.query(async () => {
    return {
      defaultBody: DEFAULT_AUTO_RESPONSE_BODY,
      mergeTags: [
        { tag: "{{return_date}}", desc: "Date you return (formatted)" },
        { tag: "{{coverage_name}}", desc: "Coverage attorney's name" },
        { tag: "{{coverage_email}}", desc: "Coverage attorney's email" },
        { tag: "{{firm_phone}}", desc: "Firm phone number" },
        { tag: "{{sender_name}}", desc: "Name of person who emailed you" },
        { tag: "{{sender_email}}", desc: "Email of person who emailed you" },
      ],
    };
  }),

  orgMembers: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.orgId) return [];
    const rows = await ctx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.orgId, ctx.user.orgId)));
    return rows.filter((u) => u.id !== ctx.user.id);
  }),
});
