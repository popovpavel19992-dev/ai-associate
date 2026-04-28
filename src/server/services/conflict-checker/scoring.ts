// src/server/services/conflict-checker/scoring.ts
//
// Phase 3.6 — Conflict checker scoring engine.
//
// Pure / deterministic name-similarity logic used by the multi-source conflict
// service. No AI, no DB, no I/O — easy to unit-test.
//
// Strategy
// --------
// 1. `normalizeName` lowercases, strips punctuation, expands "&" → "and",
//    and removes a small list of common entity suffixes (LLC, Inc, Corp,
//    Corporation, Ltd, Co, LP, LLP, PC, PLLC, "and Associates"). The
//    suffix-stripped form is what we compare on so that
//    "Acme Corp." and "Acme Corporation" collapse to "acme".
// 2. `levenshtein` is a standard DP implementation.
// 3. `similarityScore = 1 - distance / max(len(a), len(b))`.
// 4. `tokenJaccard` splits on whitespace and computes |A∩B| / |A∪B|.
// 5. `scoreMatch` returns the strongest of:
//      exact normalized match           → HIGH   (similarity = 1)
//      similarity > FUZZY_THRESHOLD     → MEDIUM
//      jaccard   > TOKEN_THRESHOLD      → LOW
//    else `null` severity.

export type Severity = "HIGH" | "MEDIUM" | "LOW";
export type MatchType = "exact" | "fuzzy" | "token_overlap";

export const FUZZY_THRESHOLD = 0.85;
export const TOKEN_THRESHOLD = 0.6;

export interface ConflictHit {
  source:
    | "client"
    | "opposing_party"
    | "opposing_counsel"
    | "witness"
    | "subpoena_recipient"
    | "mediator"
    | "demand_recipient";
  matchedName: string;
  matchedValue: string;
  severity: Severity;
  similarity: number;
  caseId?: string;
  caseName?: string;
  matchType: MatchType;
}

const ENTITY_SUFFIXES = [
  "incorporated",
  "corporation",
  "corp",
  "inc",
  "llc",
  "llp",
  "lp",
  "ltd",
  "limited",
  "co",
  "company",
  "pc",
  "pllc",
  "pa",
  "and associates",
];

export function normalizeName(name: string): string {
  if (!name) return "";
  let n = name.toLowerCase();
  // Replace "&" with " and "
  n = n.replace(/&/g, " and ");
  // Strip punctuation (keep letters, digits, whitespace).
  n = n.replace(/[^\p{L}\p{N}\s]/gu, " ");
  // Collapse whitespace
  n = n.replace(/\s+/g, " ").trim();
  // Strip trailing entity suffixes repeatedly (handles "Acme Corp Inc").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of ENTITY_SUFFIXES) {
      if (n === suf) {
        n = "";
        changed = true;
        break;
      }
      if (n.endsWith(" " + suf)) {
        n = n.slice(0, -(suf.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }
  return n;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // DP with two rolling rows
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function similarityScore(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function scoreMatch(
  query: string,
  candidate: string,
): { severity: Severity | null; similarity: number; matchType: MatchType } {
  const nq = normalizeName(query);
  const nc = normalizeName(candidate);
  if (!nq || !nc) {
    return { severity: null, similarity: 0, matchType: "fuzzy" };
  }
  if (nq === nc) {
    return { severity: "HIGH", similarity: 1, matchType: "exact" };
  }
  const sim = similarityScore(nq, nc);
  if (sim > FUZZY_THRESHOLD) {
    return { severity: "MEDIUM", similarity: sim, matchType: "fuzzy" };
  }
  const jac = tokenJaccard(nq, nc);
  if (jac > TOKEN_THRESHOLD) {
    return { severity: "LOW", similarity: jac, matchType: "token_overlap" };
  }
  return { severity: null, similarity: Math.max(sim, jac), matchType: "fuzzy" };
}

export function severityRank(s: Severity | null): number {
  switch (s) {
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
      return 1;
    default:
      return 0;
  }
}

export function highestSeverity(hits: ConflictHit[]): Severity | null {
  let best: Severity | null = null;
  for (const h of hits) {
    if (severityRank(h.severity) > severityRank(best)) best = h.severity;
  }
  return best;
}
