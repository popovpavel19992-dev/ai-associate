import { z } from "zod/v4";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { sectionPresets } from "../../db/schema/section-presets";
import { CASE_TYPES, AVAILABLE_SECTIONS } from "@/lib/constants";

export const presetsRouter = router({
  listByType: protectedProcedure
    .input(z.object({ caseType: z.enum(CASE_TYPES) }))
    .query(async ({ ctx, input }) => {
      const presets = await ctx.db
        .select()
        .from(sectionPresets)
        .where(eq(sectionPresets.caseType, input.caseType));

      return presets;
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseType: z.enum(CASE_TYPES),
        sections: z.array(z.enum(AVAILABLE_SECTIONS)).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(sectionPresets)
        .values({
          caseType: input.caseType,
          sections: input.sections,
          isSystem: false,
        })
        .returning();

      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        sections: z.array(z.enum(AVAILABLE_SECTIONS)).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [preset] = await ctx.db
        .select()
        .from(sectionPresets)
        .where(eq(sectionPresets.id, input.id))
        .limit(1);

      if (!preset) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found" });
      }

      if (preset.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot modify system presets",
        });
      }

      const [updated] = await ctx.db
        .update(sectionPresets)
        .set({ sections: input.sections })
        .where(and(eq(sectionPresets.id, input.id)))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [preset] = await ctx.db
        .select()
        .from(sectionPresets)
        .where(eq(sectionPresets.id, input.id))
        .limit(1);

      if (!preset) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found" });
      }

      if (preset.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete system presets",
        });
      }

      await ctx.db
        .delete(sectionPresets)
        .where(eq(sectionPresets.id, input.id));

      return { success: true };
    }),
});
