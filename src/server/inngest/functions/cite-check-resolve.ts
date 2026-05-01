import { eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/server/db";
import { caseMotions } from "@/server/db/schema/case-motions";
import { citeTreatments } from "@/server/db/schema/cite-treatments";
import { decideTreatment } from "@/server/services/cite-check/treatment";
import type { CiteCheckResult, CiteStatus } from "@/server/services/cite-check/types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const citeCheckResolve = inngest.createFunction(
  {
    id: "cite-check-resolve",
    retries: 2,
    triggers: [{ event: "cite-check/resolve.requested" }],
  },
  async ({ event, step }) => {
    const { citeKey, raw, type, motionId } = event.data as {
      citeKey: string;
      raw: string;
      type: "opinion" | "statute";
      motionId: string;
    };

    const decision = await step.run("fetch-and-treat", async () => {
      // Statutes don't have a CourtListener fallback; mark not_found.
      // (USC/CFR caching is fed by Phase 2.2 research seed; cache-misses here
      // mean the section isn't in our seeded set.)
      if (type !== "opinion") {
        return { status: "not_found" as const, summary: null, signals: null };
      }

      const { CourtListenerClient } = await import("@/server/services/courtlistener/client");
      const { OpinionCacheService } = await import("@/server/services/research/opinion-cache");
      const { getEnv } = await import("@/lib/env");

      const cl = new CourtListenerClient({ apiToken: getEnv().COURTLISTENER_API_TOKEN });
      const search = await cl.search({ query: raw, pageSize: 1 }).catch(() => null);
      const hit = search?.hits?.[0];
      if (!hit) {
        return { status: "not_found" as const, summary: null, signals: null };
      }

      const cache = new OpinionCacheService({ db, courtListener: cl });
      await cache.upsertSearchHit(hit);
      const fetched = await cache.getOrFetch(hit.courtlistenerId).catch(() => null);
      if (!fetched) {
        return { status: "not_found" as const, summary: null, signals: null };
      }

      const treatment = await decideTreatment({
        raw,
        type: "opinion",
        fullText: fetched.fullText ?? fetched.snippet ?? "",
        citedByCount: (fetched.metadata as { citedByCount?: number } | null)?.citedByCount,
      });

      await db
        .insert(citeTreatments)
        .values({
          citeKey,
          citeType: "opinion",
          status: treatment.status,
          summary: treatment.summary ?? null,
          signals: treatment.signals ?? null,
          expiresAt: new Date(Date.now() + TTL_MS),
        })
        .onConflictDoUpdate({
          target: citeTreatments.citeKey,
          set: {
            status: treatment.status,
            summary: treatment.summary ?? null,
            signals: treatment.signals ?? null,
            generatedAt: new Date(),
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        });

      return treatment;
    });

    await step.run("update-motion-json", async () => {
      const [motion] = await db
        .select({ id: caseMotions.id, json: caseMotions.lastCiteCheckJson })
        .from(caseMotions)
        .where(eq(caseMotions.id, motionId))
        .limit(1);
      if (!motion?.json) return;

      const current = motion.json as CiteCheckResult;
      let pendingCites = 0;
      const citations = current.citations.map((c) => {
        if (c.citeKey === citeKey && c.status === "pending") {
          return {
            ...c,
            status: decision.status as CiteStatus,
            summary: decision.summary,
            signals: decision.signals,
          };
        }
        if (c.status === "pending") pendingCites += 1;
        return c;
      });
      const next: CiteCheckResult = { ...current, pendingCites, citations };
      await db
        .update(caseMotions)
        .set({ lastCiteCheckJson: next, updatedAt: sql`updated_at` })
        .where(eq(caseMotions.id, motionId));
    });
  },
);
