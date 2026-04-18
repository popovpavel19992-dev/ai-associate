/**
 * Convert a Bluebook citation to a statute viewer URL path.
 * Returns null for unrecognized citation formats.
 */
export function citationToUrl(citation: string): string | null {
  // USC: "42 U.S.C. § 1983" → "/research/statutes/42-usc-1983"
  const uscMatch = citation.match(/^(\d+)\s+U\.S\.C\.\s+§§?\s*(\d+[a-z]?)/i);
  if (uscMatch) {
    return `/research/statutes/${uscMatch[1]}-usc-${uscMatch[2]}`;
  }
  // CFR: "28 C.F.R. § 35.104" → "/research/statutes/28-cfr-35.104"
  const cfrMatch = citation.match(/^(\d+)\s+C\.?F\.?R\.?\s+§§?\s*(\d+\.\d+[a-z]?(?:\([a-z0-9]+\))*)/i);
  if (cfrMatch) {
    return `/research/statutes/${cfrMatch[1]}-cfr-${encodeURIComponent(cfrMatch[2])}`;
  }
  return null;
}
