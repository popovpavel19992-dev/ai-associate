// src/server/services/research/collections.ts
import { and, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import {
  researchCollections,
  researchCollectionItems,
  researchItemTags,
} from "@/server/db/schema/research-collections";

export type CollectionItemType = "opinion" | "statute" | "memo" | "session";

export interface CollectionsServiceDeps {
  db?: typeof defaultDb;
}

export interface AddItemInput {
  collectionId: string;
  addedBy: string;
  item: { type: CollectionItemType; id: string };
  notes?: string | null;
  tags?: string[];
}

export class CollectionsService {
  private readonly db: typeof defaultDb;

  constructor(deps: CollectionsServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
  }

  /** Lowercases, trims, dedups, drops empty / over-50-char tags. */
  static normalizeTags(input: string[]): string[] {
    const seen = new Set<string>();
    for (const t of input) {
      const norm = t.trim().toLowerCase();
      if (norm.length === 0 || norm.length > 50) continue;
      seen.add(norm);
    }
    return Array.from(seen);
  }

  /**
   * Idempotent. If the same artifact is already in the collection,
   * returns the existing item id without inserting.
   */
  async addItem(input: AddItemInput): Promise<{ itemId: string }> {
    const fkColumn = fkColumnFor(input.item.type);
    const existing = await this.db
      .select({ id: researchCollectionItems.id })
      .from(researchCollectionItems)
      .where(
        and(
          eq(researchCollectionItems.collectionId, input.collectionId),
          eq(researchCollectionItems.itemType, input.item.type),
          eq(fkColumn, input.item.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) return { itemId: existing[0]!.id };

    const values = {
      collectionId: input.collectionId,
      itemType: input.item.type,
      opinionId: input.item.type === "opinion" ? input.item.id : null,
      statuteId: input.item.type === "statute" ? input.item.id : null,
      memoId: input.item.type === "memo" ? input.item.id : null,
      sessionId: input.item.type === "session" ? input.item.id : null,
      notes: input.notes ?? null,
      addedBy: input.addedBy,
    };
    const [row] = await this.db.insert(researchCollectionItems).values(values).returning();

    if (input.tags && input.tags.length > 0) {
      const tags = CollectionsService.normalizeTags(input.tags);
      if (tags.length > 0) {
        await this.db.insert(researchItemTags).values(
          tags.map((tag) => ({ collectionItemId: row.id, tag })),
        );
      }
    }
    await this.touchParent(input.collectionId);
    return { itemId: row.id };
  }

  async removeItem(itemId: string): Promise<void> {
    const [row] = await this.db
      .select({ collectionId: researchCollectionItems.collectionId })
      .from(researchCollectionItems)
      .where(eq(researchCollectionItems.id, itemId))
      .limit(1);
    await this.db.delete(researchCollectionItems).where(eq(researchCollectionItems.id, itemId));
    if (row) await this.touchParent(row.collectionId);
  }

  async updateItem(input: {
    itemId: string;
    notes?: string | null;
    tags?: string[];
  }): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (input.notes !== undefined) updates.notes = input.notes;
    if (Object.keys(updates).length > 0) {
      await this.db
        .update(researchCollectionItems)
        .set(updates)
        .where(eq(researchCollectionItems.id, input.itemId));
    }
    if (input.tags !== undefined) {
      const tags = CollectionsService.normalizeTags(input.tags);
      await this.db.delete(researchItemTags).where(eq(researchItemTags.collectionItemId, input.itemId));
      if (tags.length > 0) {
        await this.db.insert(researchItemTags).values(
          tags.map((tag) => ({ collectionItemId: input.itemId, tag })),
        );
      }
    }
  }

  /**
   * Bulk position update. Caller must verify all itemIds belong to this collection.
   */
  async reorder(input: { collectionId: string; itemIds: string[] }): Promise<void> {
    for (let i = 0; i < input.itemIds.length; i++) {
      await this.db
        .update(researchCollectionItems)
        .set({ position: i })
        .where(
          and(
            eq(researchCollectionItems.id, input.itemIds[i]!),
            eq(researchCollectionItems.collectionId, input.collectionId),
          ),
        );
    }
    await this.touchParent(input.collectionId);
  }

  private async touchParent(collectionId: string): Promise<void> {
    await this.db
      .update(researchCollections)
      .set({ updatedAt: new Date() })
      .where(eq(researchCollections.id, collectionId));
  }
}

function fkColumnFor(type: CollectionItemType) {
  switch (type) {
    case "opinion": return researchCollectionItems.opinionId;
    case "statute": return researchCollectionItems.statuteId;
    case "memo":    return researchCollectionItems.memoId;
    case "session": return researchCollectionItems.sessionId;
  }
}
