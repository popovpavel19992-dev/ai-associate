// Unified citation parser for USC, CFR, and case reporters.
// Pure text processing — no DB or network calls.
// Produces a deduplicated list of structured citations extracted from free text.

import { REPORTER_PATTERNS } from "./citation-validator";

export type ParsedCitation =
  | { source: "case"; citation: string }
  | { source: "usc"; title: number; section: string; citation: string }
  | { source: "cfr"; title: number; section: string; citation: string };

// USC: single section; ranges like "§§ 1981-1988" capture first section only.
const USC_PATTERN = /\b(\d+)\s+U\.S\.C\.\s+§§?\s*(\d+[a-z]?)(?:\s*[-–]\s*\d+[a-z]?)?\b/gi;

// Guard used in the REPORTER_PATTERNS loop to skip strings that are USC or CFR
// references — those are already handled by the dedicated loops above and should
// not be emitted as source: "case".
const STATUTE_GUARD = /U\.S\.C\.|C\.?F\.?R\.?/i;

// CFR: supports subparts like 35.104(a)(2). Periods in "C.F.R." are optional.
const CFR_PATTERN = /\b(\d+)\s+C\.?F\.?R\.?\s+§§?\s*(\d+\.\d+[a-z]?(?:\([a-z0-9]+\))*)/gi;

export function parseCitations(text: string): ParsedCitation[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: ParsedCitation[] = [];

  for (const match of text.matchAll(USC_PATTERN)) {
    const title = Number(match[1]);
    const section = match[2] ?? "";
    const citation = `${title} U.S.C. § ${section}`;
    const key = `usc|${title}|${section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: "usc", title, section, citation });
  }

  for (const match of text.matchAll(CFR_PATTERN)) {
    const title = Number(match[1]);
    const section = match[2] ?? "";
    const citation = `${title} C.F.R. § ${section}`;
    const key = `cfr|${title}|${section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: "cfr", title, section, citation });
  }

  for (const pattern of REPORTER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const citation = match[0].trim();
      // Skip USC/CFR hits — those are already captured by the dedicated loops.
      if (STATUTE_GUARD.test(citation)) continue;
      const key = `case|${citation.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source: "case", citation });
    }
  }

  return out;
}
