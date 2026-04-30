// src/server/services/court-rules/service.ts
//
// Phase 3.13 — Court Rules Quick Reference service.
//
// Search strategy: ILIKE for MVP (the migration also provisions a GIN tsvector
// index for future full-text upgrade — switch by changing the where clause to
// `to_tsvector(...) @@ plainto_tsquery(...)`).

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { courtRules, userRuleBookmarks, type CourtRule } from "@/server/db/schema/court-rules";
import type { db as realDb } from "@/server/db";

type Db = typeof realDb;

export interface SearchRulesQuery {
  text?: string;
  jurisdiction?: string | string[];
  category?: string | string[];
  bookmarkedBy?: string; // userId — when set, only return rules bookmarked by this user
  limit?: number;
  offset?: number;
}

export interface SearchRuleResult extends CourtRule {
  isBookmarked: boolean;
  bookmarkNotes: string | null;
}

function asArr<T>(v: T | T[] | undefined): T[] | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v : [v];
}

export async function searchRules(
  db: Db,
  query: SearchRulesQuery,
  userId?: string,
): Promise<SearchRuleResult[]> {
  const conds = [eq(courtRules.isActive, true)];

  if (query.text && query.text.trim().length > 0) {
    const pat = `%${query.text.trim()}%`;
    const numPat = `${query.text.trim()}%`;
    conds.push(
      or(
        ilike(courtRules.title, pat),
        ilike(courtRules.body, pat),
        ilike(courtRules.ruleNumber, numPat),
        ilike(courtRules.citationShort, pat),
      )!,
    );
  }
  const juris = asArr(query.jurisdiction);
  if (juris && juris.length > 0) {
    conds.push(inArray(courtRules.jurisdiction, juris));
  }
  const cats = asArr(query.category);
  if (cats && cats.length > 0) {
    conds.push(inArray(courtRules.category, cats as CourtRule["category"][]));
  }

  // Bookmark join: when bookmarkedBy is set, restrict to rules bookmarked by
  // that user. We always left-join when a userId is available so isBookmarked
  // can be returned for the UI star toggle.
  const lookupUserId = query.bookmarkedBy ?? userId;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  if (query.bookmarkedBy) {
    // Only bookmarked rules. Inner join via subquery.
    const rows = await db
      .select({
        rule: courtRules,
        bookmarkNotes: userRuleBookmarks.notes,
      })
      .from(courtRules)
      .innerJoin(
        userRuleBookmarks,
        and(
          eq(userRuleBookmarks.ruleId, courtRules.id),
          eq(userRuleBookmarks.userId, query.bookmarkedBy),
        ),
      )
      .where(and(...conds))
      .orderBy(asc(courtRules.jurisdiction), asc(courtRules.sortOrder), asc(courtRules.ruleNumber))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r.rule, isBookmarked: true, bookmarkNotes: r.bookmarkNotes ?? null }));
  }

  const rows = await db
    .select()
    .from(courtRules)
    .where(and(...conds))
    .orderBy(asc(courtRules.jurisdiction), asc(courtRules.sortOrder), asc(courtRules.ruleNumber))
    .limit(limit)
    .offset(offset);

  if (!lookupUserId) {
    return rows.map((r) => ({ ...r, isBookmarked: false, bookmarkNotes: null }));
  }

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const bms = await db
    .select({ ruleId: userRuleBookmarks.ruleId, notes: userRuleBookmarks.notes })
    .from(userRuleBookmarks)
    .where(and(eq(userRuleBookmarks.userId, lookupUserId), inArray(userRuleBookmarks.ruleId, ids)));

  const map = new Map(bms.map((b) => [b.ruleId, b.notes ?? null] as const));
  return rows.map((r) => ({
    ...r,
    isBookmarked: map.has(r.id),
    bookmarkNotes: map.get(r.id) ?? null,
  }));
}

export async function getRule(
  db: Db,
  ruleId: string,
  userId?: string,
): Promise<{
  rule: CourtRule;
  parent: CourtRule | null;
  children: CourtRule[];
  isBookmarked: boolean;
  bookmarkNotes: string | null;
} | null> {
  const [rule] = await db.select().from(courtRules).where(eq(courtRules.id, ruleId)).limit(1);
  if (!rule) return null;

  const parent = rule.parentRuleId
    ? (
        await db.select().from(courtRules).where(eq(courtRules.id, rule.parentRuleId)).limit(1)
      )[0] ?? null
    : null;

  const children = await db
    .select()
    .from(courtRules)
    .where(eq(courtRules.parentRuleId, ruleId))
    .orderBy(asc(courtRules.sortOrder), asc(courtRules.ruleNumber));

  let isBookmarked = false;
  let bookmarkNotes: string | null = null;
  if (userId) {
    const [bm] = await db
      .select({ notes: userRuleBookmarks.notes })
      .from(userRuleBookmarks)
      .where(and(eq(userRuleBookmarks.userId, userId), eq(userRuleBookmarks.ruleId, ruleId)))
      .limit(1);
    if (bm) {
      isBookmarked = true;
      bookmarkNotes = bm.notes ?? null;
    }
  }

  return { rule, parent, children, isBookmarked, bookmarkNotes };
}

export async function addBookmark(
  db: Db,
  userId: string,
  ruleId: string,
  notes?: string | null,
): Promise<{ id: string }> {
  // Idempotent — on conflict update notes (if provided) or do nothing.
  const inserted = await db
    .insert(userRuleBookmarks)
    .values({ userId, ruleId, notes: notes ?? null })
    .onConflictDoUpdate({
      target: [userRuleBookmarks.userId, userRuleBookmarks.ruleId],
      set: { notes: notes ?? null },
    })
    .returning({ id: userRuleBookmarks.id });
  return { id: inserted[0]!.id };
}

export async function removeBookmark(
  db: Db,
  userId: string,
  ruleId: string,
): Promise<void> {
  await db
    .delete(userRuleBookmarks)
    .where(and(eq(userRuleBookmarks.userId, userId), eq(userRuleBookmarks.ruleId, ruleId)));
}

export interface BookmarkListItem {
  bookmarkId: string;
  notes: string | null;
  bookmarkedAt: Date;
  rule: CourtRule;
}

export async function listBookmarks(db: Db, userId: string): Promise<BookmarkListItem[]> {
  const rows = await db
    .select({
      bookmark: userRuleBookmarks,
      rule: courtRules,
    })
    .from(userRuleBookmarks)
    .innerJoin(courtRules, eq(courtRules.id, userRuleBookmarks.ruleId))
    .where(eq(userRuleBookmarks.userId, userId))
    .orderBy(desc(userRuleBookmarks.createdAt));

  return rows.map((r) => ({
    bookmarkId: r.bookmark.id,
    notes: r.bookmark.notes,
    bookmarkedAt: r.bookmark.createdAt,
    rule: r.rule,
  }));
}

export interface JurisdictionStat {
  jurisdiction: string;
  ruleCount: number;
}

export async function listJurisdictions(db: Db): Promise<JurisdictionStat[]> {
  const rows = await db
    .select({
      jurisdiction: courtRules.jurisdiction,
      ruleCount: sql<number>`count(*)::int`,
    })
    .from(courtRules)
    .where(eq(courtRules.isActive, true))
    .groupBy(courtRules.jurisdiction)
    .orderBy(asc(courtRules.jurisdiction));

  return rows.map((r) => ({ jurisdiction: r.jurisdiction, ruleCount: r.ruleCount ?? 0 }));
}
