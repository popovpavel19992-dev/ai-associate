// src/server/trpc/routers/research-collections.ts
//
// tRPC sub-router for research.collections.* procedures (Phase 2.2.4 Task 5).
// 12 procedures: list, get, create, rename, setShare, setCase, delete,
// addItem, removeItem, updateItem, reorder, listForArtifact.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql, ne } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import {
  researchCollections,
  researchCollectionItems,
  researchItemTags,
} from "@/server/db/schema/research-collections";
import { users } from "@/server/db/schema/users";
import { CollectionsService } from "@/server/services/research/collections";
import { inngest as defaultInngest } from "@/server/inngest/client";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------
const ItemTypeSchema = z.enum(["opinion", "statute", "memo", "session"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertCollectionOwnership(db: any, collectionId: string, userId: string) {
  const [row] = await db
    .select()
    .from(researchCollections)
    .where(eq(researchCollections.id, collectionId))
    .limit(1);
  if (!row || row.deletedAt !== null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Collection not found" });
  }
  if (row.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your collection" });
  }
  return row;
}

async function assertCollectionViewable(
  db: any,
  collectionId: string,
  userId: string,
  orgId: string | null,
) {
  const [row] = await db
    .select()
    .from(researchCollections)
    .where(eq(researchCollections.id, collectionId))
    .limit(1);
  if (!row || row.deletedAt !== null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Collection not found" });
  }
  if (row.userId === userId) return row;
  if (row.sharedWithOrg && orgId && row.orgId === orgId) return row;
  throw new TRPCError({ code: "FORBIDDEN", message: "Not allowed to view this collection" });
}

// ---------------------------------------------------------------------------
// researchCollectionsRouter
// ---------------------------------------------------------------------------
export const researchCollectionsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["mine", "shared"]).default("mine"),
        caseId: z.string().uuid().optional(),
        page: z.number().int().min(1).max(50).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const conditions = [isNull(researchCollections.deletedAt)];
      if (input.scope === "mine") {
        conditions.push(eq(researchCollections.userId, ctx.user.id));
      } else {
        if (!ctx.user.orgId) return { collections: [], page: input.page, pageSize: input.pageSize };
        conditions.push(eq(researchCollections.orgId, ctx.user.orgId));
        conditions.push(eq(researchCollections.sharedWithOrg, true));
        conditions.push(ne(researchCollections.userId, ctx.user.id));
      }
      if (input.caseId) conditions.push(eq(researchCollections.caseId, input.caseId));
      const rows = await ctx.db
        .select()
        .from(researchCollections)
        .where(and(...conditions))
        .orderBy(desc(researchCollections.updatedAt))
        .limit(input.pageSize)
        .offset(offset);
      return { collections: rows, page: input.page, pageSize: input.pageSize };
    }),

  get: protectedProcedure
    .input(z.object({ collectionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const collection = await assertCollectionViewable(
        ctx.db,
        input.collectionId,
        ctx.user.id,
        ctx.user.orgId ?? null,
      );
      const items = await ctx.db
        .select()
        .from(researchCollectionItems)
        .where(eq(researchCollectionItems.collectionId, input.collectionId))
        .orderBy(researchCollectionItems.position);
      const itemIds = items.map((i: any) => i.id);
      const tags = itemIds.length
        ? await ctx.db
            .select()
            .from(researchItemTags)
            .where(sql`${researchItemTags.collectionItemId} = ANY(${itemIds})`)
        : [];
      const tagsByItem: Record<string, string[]> = {};
      for (const t of tags as Array<{ collectionItemId: string; tag: string }>) {
        (tagsByItem[t.collectionItemId] ??= []).push(t.tag);
      }
      const itemsWithTags = items.map((i: any) => ({ ...i, tags: tagsByItem[i.id] ?? [] }));
      return { collection, items: itemsWithTags, itemCount: items.length };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500).optional(),
        caseId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(researchCollections)
        .values({
          userId: ctx.user.id,
          orgId: ctx.user.orgId ?? null,
          caseId: input.caseId ?? null,
          name: input.name,
          description: input.description ?? null,
        })
        .returning();
      return { collectionId: row.id };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCollectionOwnership(ctx.db, input.collectionId, ctx.user.id);
      await ctx.db
        .update(researchCollections)
        .set({
          name: input.name,
          description: input.description ?? null,
          updatedAt: new Date(),
        })
        .where(eq(researchCollections.id, input.collectionId));
      return { ok: true };
    }),

  setShare: protectedProcedure
    .input(z.object({ collectionId: z.string().uuid(), shared: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const collection = await assertCollectionOwnership(ctx.db, input.collectionId, ctx.user.id);
      await ctx.db
        .update(researchCollections)
        .set({ sharedWithOrg: input.shared, updatedAt: new Date() })
        .where(eq(researchCollections.id, input.collectionId));
      if (input.shared && ctx.user.orgId) {
        const [sharer] = await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        const members = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.orgId, ctx.user.orgId), ne(users.id, ctx.user.id)));
        for (const m of members as Array<{ id: string }>) {
          await defaultInngest.send({
            name: "notification.research_collection_shared",
            data: {
              collectionId: input.collectionId,
              name: collection.name,
              sharerName: sharer?.name ?? "A teammate",
              sharerUserId: ctx.user.id,
              recipientUserId: m.id,
            },
          });
        }
      }
      return { ok: true };
    }),

  setCase: protectedProcedure
    .input(z.object({ collectionId: z.string().uuid(), caseId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertCollectionOwnership(ctx.db, input.collectionId, ctx.user.id);
      await ctx.db
        .update(researchCollections)
        .set({ caseId: input.caseId, updatedAt: new Date() })
        .where(eq(researchCollections.id, input.collectionId));
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ collectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCollectionOwnership(ctx.db, input.collectionId, ctx.user.id);
      await ctx.db
        .update(researchCollections)
        .set({ deletedAt: new Date() })
        .where(eq(researchCollections.id, input.collectionId));
      return { ok: true };
    }),

  addItem: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        item: z.object({ type: ItemTypeSchema, id: z.string().uuid() }),
        notes: z.string().max(2000).optional(),
        tags: z.array(z.string()).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCollectionOwnership(ctx.db, input.collectionId, ctx.user.id);
      const svc = new CollectionsService({ db: ctx.db });
      return svc.addItem({
        collectionId: input.collectionId,
        addedBy: ctx.user.id,
        item: input.item,
        notes: input.notes,
        tags: input.tags,
      });
    }),

  removeItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({ collectionId: researchCollectionItems.collectionId })
        .from(researchCollectionItems)
        .where(eq(researchCollectionItems.id, input.itemId))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      await assertCollectionOwnership(ctx.db, item.collectionId, ctx.user.id);
      const svc = new CollectionsService({ db: ctx.db });
      await svc.removeItem(input.itemId);
      return { ok: true };
    }),

  updateItem: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        notes: z.string().max(2000).nullable().optional(),
        tags: z.array(z.string()).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({ collectionId: researchCollectionItems.collectionId })
        .from(researchCollectionItems)
        .where(eq(researchCollectionItems.id, input.itemId))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      await assertCollectionOwnership(ctx.db, item.collectionId, ctx.user.id);
      const svc = new CollectionsService({ db: ctx.db });
      await svc.updateItem({ itemId: input.itemId, notes: input.notes, tags: input.tags });
      return { ok: true };
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        itemIds: z.array(z.string().uuid()).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCollectionOwnership(ctx.db, input.collectionId, ctx.user.id);
      const svc = new CollectionsService({ db: ctx.db });
      await svc.reorder({ collectionId: input.collectionId, itemIds: input.itemIds });
      return { ok: true };
    }),

  listForArtifact: protectedProcedure
    .input(z.object({ itemType: ItemTypeSchema, itemId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const fkColumn =
        input.itemType === "opinion"
          ? researchCollectionItems.opinionId
          : input.itemType === "statute"
            ? researchCollectionItems.statuteId
            : input.itemType === "memo"
              ? researchCollectionItems.memoId
              : researchCollectionItems.sessionId;
      const collections = await ctx.db
        .select({
          id: researchCollections.id,
          name: researchCollections.name,
          hasItem: sql<boolean>`EXISTS (
            SELECT 1 FROM ${researchCollectionItems}
            WHERE ${researchCollectionItems.collectionId} = ${researchCollections.id}
              AND ${researchCollectionItems.itemType} = ${input.itemType}
              AND ${fkColumn} = ${input.itemId}
          )`,
        })
        .from(researchCollections)
        .where(
          and(
            eq(researchCollections.userId, ctx.user.id),
            isNull(researchCollections.deletedAt),
          ),
        )
        .orderBy(desc(researchCollections.updatedAt));
      return { collections };
    }),
});
