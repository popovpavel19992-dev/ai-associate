/**
 * Citation extractor for Table of Authorities (ToA) generation.
 *
 * MVP scope: federal citation patterns only.
 *  - Cases (Bluebook): "Smith v. Jones, 123 F.3d 456 (9th Cir. 2010)"
 *  - US Code: "42 U.S.C. § 1983"
 *  - CFR: "29 C.F.R. § 1630.2"
 *
 * State statutes are NOT in MVP.
 */

export type CitationType = "case" | "us_code" | "cfr";

export interface Citation {
  type: CitationType;
  text: string; // raw matched text
  normalized: string; // for dedup / sort (lowercased, whitespace collapsed)
}

export interface CitationOccurrence {
  citation: Citation;
  sectionKey: string;
}

// Strip motion-memo markers so they do not accidentally feed regexes.
// Mirrors the helper in motion-pdf.tsx.
function stripMemoMarkers(text: string): string {
  return text.replace(/\[\[memo:[0-9a-fA-F-]{36}\]\]/g, "");
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// Regex sources — instantiated fresh per call to avoid stateful `g`-flag leaks.
const CASE_RE_SRC =
  "([A-Z][\\w.'&-]+(?:\\s+[A-Z][\\w.'&-]+)*\\s+v\\.\\s+[A-Z][\\w.'&-]+(?:\\s+[A-Z][\\w.'&-]+)*,\\s*\\d+\\s+[A-Z][A-Za-z.]+(?:\\s*\\d+[a-z]?)?\\s+\\d+(?:,\\s*\\d+)?\\s*\\([^)]*\\d{4}\\))";
const USC_RE_SRC = "\\d+\\s+U\\.S\\.C\\.\\s*\\u00A7\\s*\\d+(?:\\([a-zA-Z0-9]+\\))*";
const CFR_RE_SRC = "\\d+\\s+C\\.F\\.R\\.\\s*\\u00A7\\s*\\d+(?:\\.\\d+)*";

function buildRegexes(): Array<{ type: CitationType; re: RegExp }> {
  return [
    { type: "case", re: new RegExp(CASE_RE_SRC, "g") },
    { type: "us_code", re: new RegExp(USC_RE_SRC, "g") },
    { type: "cfr", re: new RegExp(CFR_RE_SRC, "g") },
  ];
}

export function extractCitations(
  sections: Record<string, { text?: string } | undefined>,
): CitationOccurrence[] {
  const out: CitationOccurrence[] = [];
  for (const [sectionKey, content] of Object.entries(sections)) {
    const raw = content?.text;
    if (!raw) continue;
    const text = stripMemoMarkers(raw);
    for (const { type, re } of buildRegexes()) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const matched = m[1] ?? m[0];
        out.push({
          citation: {
            type,
            text: matched.trim(),
            normalized: normalize(matched),
          },
          sectionKey,
        });
      }
    }
  }
  return out;
}

export function groupAndSort(occurrences: CitationOccurrence[]): {
  cases: Citation[];
  statutes: Citation[];
} {
  const caseMap = new Map<string, Citation>();
  const statuteMap = new Map<string, Citation>();
  for (const occ of occurrences) {
    const c = occ.citation;
    const bucket = c.type === "case" ? caseMap : statuteMap;
    if (!bucket.has(c.normalized)) bucket.set(c.normalized, c);
  }
  const cases = [...caseMap.values()].sort((a, b) =>
    a.text.localeCompare(b.text),
  );
  const statutes = [...statuteMap.values()].sort((a, b) =>
    a.text.localeCompare(b.text),
  );
  return { cases, statutes };
}
