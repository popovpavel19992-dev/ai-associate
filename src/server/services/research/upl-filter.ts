// src/server/services/research/upl-filter.ts
//
// Research-specific UPL output filter. Replaces banned vocabulary in AI
// responses with approved neutral alternatives and reports which banned
// terms were detected. Complements the detection-only scanner in
// `src/server/services/compliance.ts`.

/**
 * UPL-neutral replacements used by the research AI pipeline.
 * Extends the general-purpose `BANNED_WORDS` constant with context-appropriate
 * rewrites that keep Claude's responses informational rather than prescriptive.
 *
 * Order matters: multi-word phrases appear before single words that might
 * appear inside them, so phrase-level matches win.
 */
export const RESEARCH_BANNED_MAP: Readonly<Record<string, string>> = {
  "we suggest": "the provided opinions suggest",
  "legal advice": "legal information",
  "your rights": "rights under the cited opinions",
  "you have a case": "the provided opinions may be relevant",
  "best option": "one approach",
  "should": "consider",
  "must": "may need to",
  "recommend": "note that",
  "advise": "indicate",
};

export interface UplFilterResult {
  filtered: string;
  violations: string[];
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces banned UPL vocabulary with approved alternatives.
 * Match is case-insensitive, whole-word (respects \b boundaries),
 * and the replacement preserves nothing about the original casing — the
 * lowercase replacement is inserted as-is. This matches the MVP goal of
 * neutral tone; perfect casing preservation is a non-goal.
 *
 * `violations` contains each banned term that matched at least once,
 * in the order they appear in RESEARCH_BANNED_MAP.
 */
export function applyUplFilter(text: string): UplFilterResult {
  if (text === "") {
    return { filtered: "", violations: [] };
  }
  const violations = new Set<string>();
  let filtered = text;
  for (const banned of Object.keys(RESEARCH_BANNED_MAP)) {
    const replacement = RESEARCH_BANNED_MAP[banned];
    const re = new RegExp(`\\b${escapeRegex(banned)}\\b`, "gi");
    if (re.test(filtered)) {
      violations.add(banned);
      filtered = filtered.replace(
        new RegExp(`\\b${escapeRegex(banned)}\\b`, "gi"),
        replacement,
      );
    }
  }
  return { filtered, violations: Array.from(violations) };
}
