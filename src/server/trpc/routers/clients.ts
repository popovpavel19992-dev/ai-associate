// src/server/trpc/routers/clients.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { clients } from "@/server/db/schema/clients";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { cases } from "@/server/db/schema/cases";
import {
  assertClientRead,
  assertClientEdit,
  assertClientManage,
  clientListScope,
} from "../lib/permissions";
import {
  createClientSchema,
  updateClientSchema,
  deriveDisplayName,
} from "@/lib/clients";

export const clientsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        type: z.enum(["individual", "organization"]).optional(),
        status: z.enum(["active", "archived"]).default("active"),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = [clientListScope(ctx), eq(clients.status, input.status)];
      if (input.type) where.push(eq(clients.clientType, input.type));

      let orderBy = sql`${clients.updatedAt} DESC`;
      if (input.search && input.search.length > 0) {
        const tsq = sql`plainto_tsquery('english', ${input.search})`;
        where.push(sql`${clients.searchVector} @@ ${tsq}`);
        orderBy = sql`ts_rank(${clients.searchVector}, ${tsq}) DESC, ${clients.updatedAt} DESC`;
      }

      const rows = await ctx.db
        .select({
          id: clients.id,
          displayName: clients.displayName,
          clientType: clients.clientType,
          status: clients.status,
          companyName: clients.companyName,
          firstName: clients.firstName,
          lastName: clients.lastName,
          updatedAt: clients.updatedAt,
          caseCount: sql<number>`(SELECT count(*) FROM cases WHERE cases.client_id = ${clients.id})`,
          primaryContactName: sql<string | null>`(
            SELECT name FROM client_contacts
            WHERE client_id = ${clients.id} AND is_primary = true
            LIMIT 1
          )`,
        })
        .from(clients)
        .where(and(...where))
        .orderBy(orderBy)
        .limit(input.limit)
        .offset(input.offset);

      const [{ count } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(clients)
        .where(and(...where));

      return { clients: rows, total: Number(count) };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await assertClientRead(ctx, input.id);
      const contacts = await ctx.db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, client.id))
        .orderBy(desc(clientContacts.isPrimary), clientContacts.createdAt);

      const [{ count } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(cases)
        .where(eq(cases.clientId, client.id));

      return { client, contacts, caseCount: Number(count) };
    }),

  create: protectedProcedure
    .input(createClientSchema)
    .mutation(async ({ ctx, input }) => {
      const displayName =
        input.clientType === "individual"
          ? deriveDisplayName({
              clientType: "individual",
              firstName: input.firstName,
              lastName: input.lastName,
            })
          : deriveDisplayName({
              clientType: "organization",
              companyName: input.companyName,
            });

      const [created] = await ctx.db
        .insert(clients)
        .values({
          orgId: ctx.user.orgId,
          userId: ctx.user.id,
          clientType: input.clientType,
          displayName,
          firstName: input.clientType === "individual" ? input.firstName : null,
          lastName: input.clientType === "individual" ? input.lastName : null,
          dateOfBirth: input.clientType === "individual" ? input.dateOfBirth ?? null : null,
          companyName: input.clientType === "organization" ? input.companyName : null,
          ein: input.clientType === "organization" ? input.ein ?? null : null,
          industry: input.clientType === "organization" ? input.industry ?? null : null,
          website: input.clientType === "organization" ? input.website ?? null : null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          zipCode: input.zipCode ?? null,
          country: input.country,
          notes: input.notes ?? null,
        })
        .returning();

      return { client: created };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: updateClientSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await assertClientEdit(ctx, input.id);

      // Recompute displayName if name fields changed.
      const merged = { ...existing, ...input.patch };
      const displayName =
        existing.clientType === "individual"
          ? deriveDisplayName({
              clientType: "individual",
              firstName: merged.firstName,
              lastName: merged.lastName,
            })
          : deriveDisplayName({
              clientType: "organization",
              companyName: merged.companyName,
            });

      const [updated] = await ctx.db
        .update(clients)
        .set({
          ...input.patch,
          displayName,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, input.id))
        .returning();

      return { client: updated };
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertClientManage(ctx, input.id);
      const [updated] = await ctx.db
        .update(clients)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(clients.id, input.id))
        .returning();
      return { client: updated };
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertClientManage(ctx, input.id);
      const [updated] = await ctx.db
        .update(clients)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(clients.id, input.id))
        .returning();
      return { client: updated };
    }),

  searchForPicker: protectedProcedure
    .input(
      z.object({
        q: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tsq = sql`plainto_tsquery('english', ${input.q})`;
      const rows = await ctx.db
        .select({
          id: clients.id,
          displayName: clients.displayName,
          clientType: clients.clientType,
        })
        .from(clients)
        .where(
          and(
            clientListScope(ctx),
            eq(clients.status, "active"),
            sql`${clients.searchVector} @@ ${tsq}`,
          ),
        )
        .orderBy(sql`ts_rank(${clients.searchVector}, ${tsq}) DESC`)
        .limit(input.limit);

      return { clients: rows };
    }),

  getCases: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertClientRead(ctx, input.clientId);
      const rows = await ctx.db
        .select({
          id: cases.id,
          name: cases.name,
          status: cases.status,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
        })
        .from(cases)
        .where(eq(cases.clientId, input.clientId))
        .orderBy(desc(cases.updatedAt));
      return { cases: rows };
    }),
});
