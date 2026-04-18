// Citation validator for legal AI responses.
// Pure text processing — no DB or network calls.
// Used to detect and verify US legal reporter citations returned by the LLM
// against a known-good context set (e.g. citations pulled from retrieved opinions).

/**
 * Compiled regex patterns for common US legal reporters.
 * Each pattern uses the global + case-insensitive flags so `String.prototype.matchAll`
 * works and citations with nonstandard casing (e.g. "s. ct.") still match.
 */
export const REPORTER_PATTERNS: readonly RegExp[] = [
  /\b\d+\s+U\.S\.\s+\d+\b/gi, // "123 U.S. 456"
  /\b\d+\s+S\.\s?Ct\.\s+\d+\b/gi, // "123 S.Ct. 456" or "123 S. Ct. 456"
  /\b\d+\s+F\.(?:2d|3d|4th)\s+\d+\b/gi, // "123 F.3d 456"
  /\b\d+\s+F\.\s?Supp\.\s?(?:2d|3d)?\s+\d+\b/gi, // "123 F.Supp.2d 456"
  /\b\d+\s+Cal\.(?:\s?(?:2d|3d|4th|5th))?\s+\d+\b/gi, // "123 Cal. 456" / "123 Cal.2d 456" / "123 Cal.3d 456" / "123 Cal.4th 456" / "123 Cal.5th 456"
  /\b\d+\s+N\.Y\.(?:\s?(?:2d|3d))?\s+\d+\b/gi, // "123 N.Y. 456" / "123 N.Y.2d 456" / "123 N.Y.3d 456"
  /\b\d+\s+Tex\.\s+\d+\b/gi, // "123 Tex. 456"
  /\b\d+\s+So\.\s?(?:2d|3d)?\s+\d+\b/gi, // "123 So.2d 456"
  /\b\d+\s+Ill\.(?:\s?(?:2d|3d))?\s+\d+\b/gi, // "123 Ill. 456" / "123 Ill.2d 456" / "123 Ill.3d 456"
  /\b\d+\s+U\.S\.C\.\s+§§?\s*\d+[a-z]?\b/gi, // "42 U.S.C. § 1983"
  /\b\d+\s+C\.?F\.?R\.?\s+§§?\s*\d+\.\d+[a-z]?(?:\([a-z0-9]+\))*/gi, // "28 CFR § 35.104(a)(2)"
];

/**
 * Extract deduplicated, trimmed citation strings from `text`.
 * Order is not guaranteed; callers should treat the result as a set.
 */
export function extractCitations(text: string): string[] {
  const found = new Set<string>();
  if (!text) return [];
  for (const pattern of REPORTER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[0].trim());
    }
  }
  return [...found];
}

function normalize(citation: string): string {
  // Lowercase, collapse any whitespace run to a single space, then drop spaces
  // adjacent to punctuation so "S.Ct." and "S. Ct." compare equal.
  return citation
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .trim();
}

/**
 * Extract citations from `text` and partition them into verified/unverified
 * buckets based on whether their normalized form appears in `contextCitations`.
 * Normalization: lowercase + whitespace collapsed to a single space, trimmed.
 * The returned arrays contain the ORIGINAL matched strings from the text.
 */
export function validateCitations(
  text: string,
  contextCitations: string[],
): { verified: string[]; unverified: string[] } {
  const found = extractCitations(text);
  const ctxNorm = new Set(contextCitations.map(normalize));
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const citation of found) {
    if (ctxNorm.has(normalize(citation))) {
      verified.push(citation);
    } else {
      unverified.push(citation);
    }
  }
  return { verified, unverified };
}
