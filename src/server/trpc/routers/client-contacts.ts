// src/server/trpc/routers/client-contacts.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { assertClientRead, assertClientEdit } from "../lib/permissions";
import { contactSchema } from "@/lib/clients";

/**
 * Resolve a contact row, then verify the caller can edit its parent client.
 * Throws NOT_FOUND if the contact doesn't exist.
 */
async function loadContactForEdit(
  ctx: { db: typeof import("@/server/db").db; user: { id: string; orgId: string | null; role: string | null } },
  contactId: string,
) {
  const [row] = await ctx.db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, contactId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
  await assertClientEdit(ctx, row.clientId);
  return row;
}

export const clientContactsRouter = router({
  list: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertClientRead(ctx, input.clientId);
      const rows = await ctx.db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, input.clientId))
        .orderBy(asc(clientContacts.createdAt));
      return { contacts: rows };
    }),

  create: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }).extend(contactSchema.shape))
    .mutation(async ({ ctx, input }) => {
      await assertClientEdit(ctx, input.clientId);
      const { clientId, ...fields } = input;

      const contact = await ctx.db.transaction(async (tx) => {
        if (fields.isPrimary) {
          await tx
            .update(clientContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)),
            );
        }
        const [created] = await tx
          .insert(clientContacts)
          .values({
            clientId,
            name: fields.name,
            title: fields.title ?? null,
            email: fields.email ?? null,
            phone: fields.phone ?? null,
            isPrimary: fields.isPrimary ?? false,
            notes: fields.notes ?? null,
          })
          .returning();
        return created;
      });

      return { contact };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        patch: contactSchema.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadContactForEdit(ctx, input.id);

      const contact = await ctx.db.transaction(async (tx) => {
        if (input.patch.isPrimary === true && !existing.isPrimary) {
          await tx
            .update(clientContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(clientContacts.clientId, existing.clientId),
                eq(clientContacts.isPrimary, true),
              ),
            );
        }
        const [updated] = await tx
          .update(clientContacts)
          .set({ ...input.patch, updatedAt: new Date() })
          .where(eq(clientContacts.id, input.id))
          .returning();
        return updated;
      });

      return { contact };
    }),

  setPrimary: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadContactForEdit(ctx, input.id);

      const contact = await ctx.db.transaction(async (tx) => {
        await tx
          .update(clientContacts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(clientContacts.clientId, existing.clientId),
              eq(clientContacts.isPrimary, true),
            ),
          );
        const [updated] = await tx
          .update(clientContacts)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(clientContacts.id, input.id))
          .returning();
        return updated;
      });

      return { contact };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadContactForEdit(ctx, input.id);

      await ctx.db.transaction(async (tx) => {
        await tx.delete(clientContacts).where(eq(clientContacts.id, input.id));

        if (existing.isPrimary) {
          // Promote oldest remaining contact (if any) to primary.
          const [next] = await tx
            .select()
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.clientId, existing.clientId),
                ne(clientContacts.id, existing.id),
              ),
            )
            .orderBy(asc(clientContacts.createdAt))
            .limit(1);
          if (next) {
            await tx
              .update(clientContacts)
              .set({ isPrimary: true, updatedAt: new Date() })
              .where(eq(clientContacts.id, next.id));
          }
        }
      });

      return { ok: true as const };
    }),
});
