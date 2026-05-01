import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseMotions } from "@/server/db/schema/case-motions";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { extractCitations } from "./extract";
import { citeKey } from "./normalize";
import { resolveCite } from "./resolve";
import type { CiteCheckCitation, CiteCheckResult } from "./types";

const EXTRACT_COST = 1;
const PER_CITE_COST = 1;
const DEDUP_WINDOW_MS = 60_000;

export interface RunArgs {
  motionId: string;
  userId: string;
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits for cite-check");
    this.name = "InsufficientCreditsError";
  }
}

export async function runCiteCheck(args: RunArgs): Promise<CiteCheckResult> {
  const [motion] = await db
    .select()
    .from(caseMotions)
    .where(eq(caseMotions.id, args.motionId))
    .limit(1);
  if (!motion) throw new Error(`Motion ${args.motionId} not found`);

  // Dedup: if existing run is recent and still pending, return it instead of starting new.
  const prior = motion.lastCiteCheckJson as CiteCheckResult | null;
  if (prior && prior.pendingCites > 0) {
    const ageMs = Date.now() - new Date(prior.runAt).getTime();
    if (ageMs < DEDUP_WINDOW_MS) return prior;
  }

  // Charge extract upfront.
  const ok = await decrementCredits(args.userId, EXTRACT_COST);
  if (!ok) throw new InsufficientCreditsError();

  let extracted: Awaited<ReturnType<typeof extractCitations>> = [];
  try {
    const sections = motion.sections as Record<string, { text?: string } | undefined>;
    const combined = [
      sections.facts?.text ?? "",
      sections.argument?.text ?? "",
      sections.conclusion?.text ?? "",
    ].join("\n\n");
    extracted = await extractCitations(combined);
  } catch (e) {
    await refundCredits(args.userId, EXTRACT_COST);
    throw e;
  }

  const citations: CiteCheckCitation[] = [];
  let creditsCharged = EXTRACT_COST;
  let pendingCites = 0;
  let budgetExhausted = false;

  for (const c of extracted) {
    const key = citeKey(c.raw, c.type);
    const sectionKey = locateSection(motion.sections, c.raw);

    if (budgetExhausted) {
      citations.push({
        raw: c.raw,
        citeKey: key,
        type: c.type,
        status: "unverified",
        summary: "Credit budget exhausted — re-run after topping up",
        signals: null,
        location: { sectionKey, offset: 0 },
      });
      continue;
    }

    const result = await resolveCite({ raw: c.raw, type: c.type, citeKey: key, motionId: args.motionId });

    let status = result.status;
    let summary = result.summary;
    let signals = result.signals;

    if (result.charged) {
      const charged = await decrementCredits(args.userId, PER_CITE_COST);
      if (!charged) {
        budgetExhausted = true;
        status = "unverified";
        summary = "Credit budget exhausted — re-run after topping up";
        signals = null;
      } else {
        creditsCharged += PER_CITE_COST;
      }
    }

    if (status === "pending") pendingCites += 1;

    citations.push({
      raw: c.raw,
      citeKey: key,
      type: c.type,
      status,
      summary,
      signals,
      location: { sectionKey, offset: 0 },
    });
  }

  const result: CiteCheckResult = {
    runAt: new Date().toISOString(),
    totalCites: extracted.length,
    pendingCites,
    citations,
    creditsCharged,
  };

  await db
    .update(caseMotions)
    .set({ lastCiteCheckJson: result })
    .where(eq(caseMotions.id, args.motionId));

  return result;
}

function locateSection(
  sections: unknown,
  raw: string,
): "facts" | "argument" | "conclusion" {
  const s = sections as Record<string, { text?: string } | undefined>;
  for (const key of ["facts", "argument", "conclusion"] as const) {
    if (s[key]?.text?.includes(raw)) return key;
  }
  return "argument";
}
