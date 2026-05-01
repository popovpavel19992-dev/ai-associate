import { CourtListenerClient } from "@/server/services/courtlistener/client";
import type { PeoplePerson } from "@/server/services/courtlistener/types";

const SUFFIX_RE = /\b(esq\.?|jr\.?|sr\.?|iii|iv|ii)\b/gi;

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(SUFFIX_RE, "")
    .replace(/\b[a-z]\.\s/g, "") // strip middle initials like "a. "
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastTokenScore(a: string, b: string): number {
  const al = a.split(" ").pop() ?? "";
  const bl = b.split(" ").pop() ?? "";
  return al && al === bl ? 0.5 : 0;
}

function fullExactScore(a: string, b: string): number {
  return a && a === b ? 0.5 : 0;
}

function firmBoost(firm: string | undefined, person: PeoplePerson): number {
  if (!firm) return 0;
  const norm = firm.toLowerCase().trim();
  if (!norm) return 0;
  return (person.positions ?? []).some((p) =>
    p.organization_name?.toLowerCase().includes(norm),
  )
    ? 0.2
    : 0;
}

export interface MatchResult {
  clPersonId: string;
  clFirmName: string | null;
  confidence: number;
}

export interface MatchAttorneyDeps {
  client?: CourtListenerClient;
}

export async function matchAttorney(
  args: { name: string; firm?: string },
  deps?: MatchAttorneyDeps,
): Promise<MatchResult | null> {
  const target = normalizeName(args.name);
  if (!target) return null;
  const client =
    deps?.client ??
    new CourtListenerClient({ apiToken: process.env.COURTLISTENER_API_TOKEN ?? "" });

  let res;
  try {
    res = await client.people({ name: args.name, pageSize: 10 });
  } catch {
    return null;
  }

  let best: { person: PeoplePerson; score: number } | null = null;
  for (const p of res.results) {
    const cand = normalizeName(p.name_full);
    const score =
      fullExactScore(target, cand) + lastTokenScore(target, cand) + firmBoost(args.firm, p);
    if (!best || score > best.score) best = { person: p, score };
  }
  if (!best || best.score < 0.6) return null;

  const firmName =
    best.person.positions?.find((p) => p.organization_name)?.organization_name ?? null;
  return {
    clPersonId: String(best.person.id),
    clFirmName: firmName,
    confidence: Math.min(1, best.score),
  };
}
