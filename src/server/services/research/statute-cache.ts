import { eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { cachedStatutes, type CachedStatute } from "@/server/db/schema/cached-statutes";
import { GovInfoClient, GovInfoError } from "@/server/services/govinfo/client";
import { EcfrClient, EcfrError } from "@/server/services/ecfr/client";
import type { UscSectionResult } from "@/server/services/govinfo/types";
import type { CfrSectionResult } from "@/server/services/ecfr/types";

type StatuteSource = "usc" | "cfr";

export interface StatuteCacheDeps {
  db?: typeof defaultDb;
  govinfo: GovInfoClient;
  ecfr: EcfrClient;
}

export class StatuteCacheService {
  private readonly db: typeof defaultDb;
  private readonly usc: GovInfoClient;
  private readonly cfr: EcfrClient;

  constructor(deps: StatuteCacheDeps) {
    this.db = deps.db ?? defaultDb;
    this.usc = deps.govinfo;
    this.cfr = deps.ecfr;
  }

  /**
   * Upsert from a full search/lookup hit. On conflict, refresh heading
   * ONLY if the new hit has a non-empty value — never overwrite real data
   * with blanks. Uses the hit's `source` discriminator.
   */
  async upsertSearchHit(hit: UscSectionResult | CfrSectionResult): Promise<CachedStatute> {
    const now = new Date();
    const newHeading = hit.heading && hit.heading.length > 0 ? hit.heading : null;

    const [row] = await this.db
      .insert(cachedStatutes)
      .values({
        source: hit.source,
        citationBluebook: hit.citationBluebook,
        title: String(hit.title),
        section: hit.section,
        heading: newHeading,
        effectiveDate: hit.effectiveDate ?? null,
        metadata: hit.metadata ?? {},
      })
      .onConflictDoUpdate({
        target: [cachedStatutes.source, cachedStatutes.citationBluebook],
        set: {
          // Preserve existing non-null heading when the new hit has no heading.
          heading: newHeading
            ? sql`${newHeading}::text`
            : sql`${cachedStatutes.heading}`,
          lastAccessedAt: now,
        },
      })
      .returning();
    return row as CachedStatute;
  }

  /**
   * Upsert a bare metadata row when only citation identifiers are known
   * (no heading, no body). Body can be fetched later via getOrFetch.
   */
  async upsertMetadataOnly(params: {
    source: StatuteSource;
    title: number;
    section: string;
    citationBluebook: string;
  }): Promise<CachedStatute> {
    const now = new Date();
    const [row] = await this.db
      .insert(cachedStatutes)
      .values({
        source: params.source,
        citationBluebook: params.citationBluebook,
        title: String(params.title),
        section: params.section,
        heading: null,
        effectiveDate: null,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: [cachedStatutes.source, cachedStatutes.citationBluebook],
        set: { lastAccessedAt: now },
      })
      .returning();
    return row as CachedStatute;
  }

  async getOrFetch(internalId: string): Promise<CachedStatute> {
    const [existing] = await this.db
      .select()
      .from(cachedStatutes)
      .where(eq(cachedStatutes.id, internalId))
      .limit(1);
    if (!existing) throw new Error(`Statute not found: ${internalId}`);

    if (existing.bodyText && existing.bodyText.length > 0) {
      const now = new Date();
      await this.db
        .update(cachedStatutes)
        .set({ lastAccessedAt: now })
        .where(eq(cachedStatutes.id, existing.id));
      return { ...existing, lastAccessedAt: now } as CachedStatute;
    }

    const title = Number(existing.title);
    const section = existing.section;
    try {
      const detail =
        existing.source === "usc"
          ? await this.usc.lookupUscSection(title, section)
          : await this.cfr.lookupCfrSection(title, section);
      if (!detail) {
        return this.markFailed(existing.id);
      }

      // USC path (GovInfo): search returns metadata only; body via second call.
      let bodyText = detail.bodyText;
      if (existing.source === "usc" && bodyText === "" && "granuleId" in detail) {
        bodyText = await this.usc.fetchBody(detail.granuleId, detail.packageId);
      }

      const metadataPatch = {
        ...(existing.metadata ?? {}),
        ...(detail.metadata ?? {}),
        enrichmentStatus: "done" as const,
      };
      const [row] = await this.db
        .update(cachedStatutes)
        .set({
          bodyText,
          heading: detail.heading,
          effectiveDate: detail.effectiveDate ?? null,
          metadata: metadataPatch,
          lastAccessedAt: new Date(),
        })
        .where(eq(cachedStatutes.id, existing.id))
        .returning();
      return row as CachedStatute;
    } catch (err) {
      if (err instanceof GovInfoError || err instanceof EcfrError) {
        return this.markFailed(existing.id);
      }
      throw err;
    }
  }

  async getByInternalIds(ids: string[]): Promise<CachedStatute[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(cachedStatutes)
      .where(inArray(cachedStatutes.id, ids));
    return rows as CachedStatute[];
  }

  private async markFailed(id: string): Promise<CachedStatute> {
    const patch = { enrichmentStatus: "failed" as const };
    const [row] = await this.db
      .update(cachedStatutes)
      .set({
        metadata: sql`${cachedStatutes.metadata} || ${JSON.stringify(patch)}::jsonb`,
        lastAccessedAt: new Date(),
      })
      .where(eq(cachedStatutes.id, id))
      .returning();
    return row as CachedStatute;
  }
}
