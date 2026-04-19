import { db as defaultDb } from "@/server/db";
import { cachedOpinions, type CachedOpinion } from "@/server/db/schema/cached-opinions";
import type { CourtListenerClient } from "@/server/services/courtlistener/client";
import type { OpinionSearchHit } from "@/server/services/courtlistener/types";
import { eq, inArray, sql } from "drizzle-orm";

export interface OpinionCacheDeps {
  db?: typeof defaultDb;
  courtListener: CourtListenerClient;
}

export class OpinionCacheService {
  private readonly db: typeof defaultDb;
  private readonly cl: CourtListenerClient;

  constructor(deps: OpinionCacheDeps) {
    this.db = deps.db ?? defaultDb;
    this.cl = deps.courtListener;
  }

  async upsertSearchHit(hit: OpinionSearchHit): Promise<CachedOpinion> {
    const now = new Date();
    const [row] = await this.db
      .insert(cachedOpinions)
      .values({
        courtlistenerId: hit.courtlistenerId,
        caseName: hit.caseName,
        court: hit.court,
        jurisdiction: hit.jurisdiction,
        courtLevel: hit.courtLevel,
        decisionDate: hit.decisionDate,
        citationBluebook: hit.citationBluebook,
        snippet: hit.snippet,
      })
      .onConflictDoUpdate({
        target: cachedOpinions.courtlistenerId,
        set: { snippet: hit.snippet, lastAccessedAt: now },
      })
      .returning();
    return row as CachedOpinion;
  }

  async getOrFetch(courtlistenerId: number): Promise<CachedOpinion> {
    const [existing] = await this.db
      .select()
      .from(cachedOpinions)
      .where(eq(cachedOpinions.courtlistenerId, courtlistenerId))
      .limit(1);

    if (existing && typeof existing.fullText === "string" && existing.fullText.length > 0) {
      const now = new Date();
      await this.db
        .update(cachedOpinions)
        .set({ lastAccessedAt: now })
        .where(eq(cachedOpinions.id, existing.id));
      return { ...existing, lastAccessedAt: now } as CachedOpinion;
    }

    const detail = await this.cl.getOpinion(courtlistenerId);
    const metadataPatch = {
      judges: detail.judges,
      syllabusUrl: detail.syllabusUrl,
      citedByCount: detail.citedByCount,
    };
    const now = new Date();

    // When the row is already cached from a search hit (the common case in v4,
    // where the opinion detail endpoint lacks court/jurisdiction/dateFiled),
    // patch the dynamic fields in place. The court info from the search hit
    // is authoritative — don't overwrite it with the empty values the detail
    // endpoint returns. Only fall back to INSERT for genuinely new opinions.
    if (existing) {
      const [row] = await this.db
        .update(cachedOpinions)
        .set({
          fullText: detail.fullText,
          metadata: sql`${cachedOpinions.metadata} || ${JSON.stringify(metadataPatch)}::jsonb`,
          lastAccessedAt: now,
        })
        .where(eq(cachedOpinions.id, existing.id))
        .returning();
      return row as CachedOpinion;
    }

    const [row] = await this.db
      .insert(cachedOpinions)
      .values({
        courtlistenerId: detail.courtlistenerId,
        caseName: detail.caseName,
        court: detail.court,
        jurisdiction: detail.jurisdiction,
        courtLevel: detail.courtLevel,
        decisionDate: detail.decisionDate,
        citationBluebook: detail.citationBluebook,
        fullText: detail.fullText,
        snippet: "",
        metadata: metadataPatch,
      })
      .onConflictDoUpdate({
        target: cachedOpinions.courtlistenerId,
        set: {
          fullText: detail.fullText,
          metadata: sql`${cachedOpinions.metadata} || ${JSON.stringify(metadataPatch)}::jsonb`,
          lastAccessedAt: now,
        },
      })
      .returning();
    return row as CachedOpinion;
  }

  async getByInternalIds(ids: string[]): Promise<CachedOpinion[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(cachedOpinions)
      .where(inArray(cachedOpinions.id, ids));
    return rows as CachedOpinion[];
  }
}
