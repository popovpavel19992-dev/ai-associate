import type { CiteType } from "./types";

const REPORTER_RX =
  /(\d+)\s+(U\.?S\.?|S\.?\s*Ct\.?|L\.?\s*Ed\.?\s*2d|F\.?\s*\d?d?|F\.?\s*Supp\.?\s*\d?d?|F\.?\s*App'?x|N\.?E\.?\s*\d?d?|P\.?\s*\d?d?|S\.?W\.?\s*\d?d?|N\.?W\.?\s*\d?d?|A\.?\s*\d?d?|S\.?E\.?\s*\d?d?|So\.?\s*\d?d?|Cal\.?\s*\d?d?|N\.?Y\.?\s*\d?d?)\s+(\d+)(?:[^()]*\((?:[^)]*?)\s*(\d{4})\))?/i;

const USC_RX = /(\d+)\s+U\.?\s*S\.?\s*C\.?\s+§§?\s*(\d+(?:[a-z])?(?:\.\d+)?(?:\([a-z0-9]+\))*)/i;
const CFR_RX = /(\d+)\s+C\.?\s*F\.?\s*R\.?\s+§§?\s*(\d+\.\d+(?:[a-z])?(?:\([a-z0-9]+\))*)/i;

function compactReporter(s: string): string {
  return s.toLowerCase().replace(/[\s.']/g, "");
}

function compactSection(s: string): string {
  return s.toLowerCase().replace(/[\s.()'§]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export function citeKey(raw: string, type: CiteType): string {
  if (type === "statute") {
    let m = raw.match(USC_RX);
    if (m) return `${m[1]}_usc_${compactSection(m[2])}`;
    m = raw.match(CFR_RX);
    if (m) return `${m[1]}_cfr_${compactSection(m[2])}`;
    return "malformed";
  }
  const m = raw.match(REPORTER_RX);
  if (!m) return "malformed";
  const vol = m[1];
  const reporter = compactReporter(m[2]);
  const page = m[3];
  const year = m[4] ?? "";
  return year ? `${vol}_${reporter}_${page}_${year}` : `${vol}_${reporter}_${page}`;
}
