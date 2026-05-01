import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { citeTreatments } from "@/server/db/schema/cite-treatments";
import { cachedOpinions } from "@/server/db/schema/cached-opinions";
import { cachedStatutes } from "@/server/db/schema/cached-statutes";
import { inngest } from "@/server/inngest/client";
import { decideTreatment } from "./treatment";
import type { CiteStatus, CiteType, TreatmentDecision } from "./types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolveArgs {
  raw: string;
  type: CiteType;
  citeKey: string;
  motionId: string;
}

export interface ResolveResult {
  status: CiteStatus;
  summary: string | null;
  signals: TreatmentDecision["signals"];
  charged: boolean;
}

export async function resolveCite(args: ResolveArgs): Promise<ResolveResult> {
  if (args.citeKey === "malformed") {
    return { status: "malformed", summary: null, signals: null, charged: false };
  }

  const [cached] = await db
    .select()
    .from(citeTreatments)
    .where(and(eq(citeTreatments.citeKey, args.citeKey), gt(citeTreatments.expiresAt, sql`now()`)))
    .limit(1);
  if (cached) {
    return {
      status: cached.status as CiteStatus,
      summary: cached.summary,
      signals: cached.signals as TreatmentDecision["signals"],
      charged: false,
    };
  }

  if (args.type === "opinion") {
    const [op] = await db
      .select()
      .from(cachedOpinions)
      .where(eq(cachedOpinions.citationBluebook, args.raw))
      .limit(1);
    if (op) {
      const decision = await decideTreatment({
        raw: args.raw,
        type: "opinion",
        fullText: op.fullText ?? op.snippet ?? "",
        citedByCount: (op.metadata as { citedByCount?: number })?.citedByCount,
      });
      await persistTreatment(args.citeKey, "opinion", decision);
      return { ...decision, charged: true };
    }
  } else {
    const [st] = await db
      .select()
      .from(cachedStatutes)
      .where(eq(cachedStatutes.citationBluebook, args.raw))
      .limit(1);
    if (st) {
      const decision = await decideTreatment({
        raw: args.raw,
        type: "statute",
        fullText: st.bodyText ?? st.heading ?? "",
      });
      await persistTreatment(args.citeKey, "statute", decision);
      return { ...decision, charged: true };
    }
  }

  await inngest.send({
    name: "cite-check/resolve.requested",
    data: { citeKey: args.citeKey, raw: args.raw, type: args.type, motionId: args.motionId },
  });
  return { status: "pending", summary: null, signals: null, charged: false };
}

async function persistTreatment(citeKey: string, citeType: CiteType, decision: TreatmentDecision) {
  await db
    .insert(citeTreatments)
    .values({
      citeKey,
      citeType,
      status: decision.status,
      summary: decision.summary ?? null,
      signals: decision.signals ?? null,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .onConflictDoUpdate({
      target: citeTreatments.citeKey,
      set: {
        status: decision.status,
        summary: decision.summary ?? null,
        signals: decision.signals ?? null,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
}
