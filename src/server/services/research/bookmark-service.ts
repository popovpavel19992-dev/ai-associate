import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { opinionBookmarks, type OpinionBookmark } from "@/server/db/schema/opinion-bookmarks";

export interface BookmarkServiceDeps {
  db?: typeof defaultDb;
  // Hook for future activity-log / notification emission.
  // Called after a bookmark is created or updated with a non-null caseId.
  onCaseLink?: (ctx: {
    userId: string;
    bookmarkId: string;
    opinionId: string;
    caseId: string;
  }) => void | Promise<void>;
}

export class BookmarkService {
  private readonly db: typeof defaultDb;
  private readonly onCaseLink?: BookmarkServiceDeps["onCaseLink"];

  constructor(deps?: BookmarkServiceDeps) {
    this.db = deps?.db ?? defaultDb;
    this.onCaseLink = deps?.onCaseLink;
  }

  async create(opts: {
    userId: string;
    opinionId: string;
    notes?: string | null;
    caseId?: string | null;
  }): Promise<OpinionBookmark> {
    const notes = opts.notes ?? null;
    const caseId = opts.caseId ?? null;

    const [row] = await this.db
      .insert(opinionBookmarks)
      .values({
        userId: opts.userId,
        opinionId: opts.opinionId,
        notes,
        caseId,
      })
      .onConflictDoUpdate({
        target: [opinionBookmarks.userId, opinionBookmarks.opinionId],
        set: { notes, caseId },
      })
      .returning();

    const bookmark = row as OpinionBookmark;
    if (caseId !== null && this.onCaseLink) {
      await this.onCaseLink({
        userId: opts.userId,
        bookmarkId: bookmark.id,
        opinionId: opts.opinionId,
        caseId,
      });
    }
    return bookmark;
  }

  async update(opts: {
    bookmarkId: string;
    userId: string;
    notes?: string | null;
    caseId?: string | null;
  }): Promise<OpinionBookmark> {
    const [existing] = await this.db
      .select()
      .from(opinionBookmarks)
      .where(eq(opinionBookmarks.id, opts.bookmarkId))
      .limit(1);

    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Bookmark not found" });
    if (existing.userId !== opts.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not your bookmark" });
    }

    const set: Record<string, unknown> = {};
    if (opts.notes !== undefined) set.notes = opts.notes;
    if (opts.caseId !== undefined) set.caseId = opts.caseId;

    if (Object.keys(set).length === 0) {
      return existing as OpinionBookmark;
    }

    const [row] = await this.db
      .update(opinionBookmarks)
      .set(set)
      .where(eq(opinionBookmarks.id, opts.bookmarkId))
      .returning();

    const bookmark = row as OpinionBookmark;
    if (opts.caseId !== undefined && opts.caseId !== null && this.onCaseLink) {
      await this.onCaseLink({
        userId: opts.userId,
        bookmarkId: opts.bookmarkId,
        opinionId: bookmark.opinionId ?? (existing as OpinionBookmark).opinionId,
        caseId: opts.caseId,
      });
    }
    return bookmark;
  }

  async delete(opts: { bookmarkId: string; userId: string }): Promise<void> {
    const [existing] = await this.db
      .select({ userId: opinionBookmarks.userId })
      .from(opinionBookmarks)
      .where(eq(opinionBookmarks.id, opts.bookmarkId))
      .limit(1);

    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Bookmark not found" });
    if (existing.userId !== opts.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not your bookmark" });
    }

    await this.db.delete(opinionBookmarks).where(eq(opinionBookmarks.id, opts.bookmarkId));
  }

  async listByUser(opts: { userId: string; caseId?: string }): Promise<OpinionBookmark[]> {
    const conds = [eq(opinionBookmarks.userId, opts.userId)];
    if (opts.caseId) conds.push(eq(opinionBookmarks.caseId, opts.caseId));
    const rows = await this.db
      .select()
      .from(opinionBookmarks)
      .where(and(...conds))
      .orderBy(desc(opinionBookmarks.createdAt));
    return rows as OpinionBookmark[];
  }
}
