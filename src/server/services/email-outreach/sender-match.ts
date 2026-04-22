// src/server/services/email-outreach/sender-match.ts

export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const atIdx = trimmed.indexOf("@");
  if (atIdx < 0) return trimmed;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx);
  const plusIdx = local.indexOf("+");
  const cleanLocal = plusIdx < 0 ? local : local.slice(0, plusIdx);
  return cleanLocal + domain;
}

export function isSenderMismatch(from: string, expectedRecipient: string): boolean {
  return normalizeEmail(from) !== normalizeEmail(expectedRecipient);
}
