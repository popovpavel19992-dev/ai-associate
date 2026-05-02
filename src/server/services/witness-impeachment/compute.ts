import { createHash } from "node:crypto";
import type { StatementSnapshot } from "@/server/db/schema/case-witness-impeachment-scans";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface StatementLike {
  statementId: string;
  text: string;
}

export function computeStatementsHash(statements: StatementLike[]): string {
  const sorted = [...statements].sort((a, b) =>
    a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0,
  );
  const payload = sorted.map((s) => `${s.statementId}:${contentHash(s.text)}`).join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

export function isStaleStatementSet(
  snapshot: StatementSnapshot[],
  current: Array<{ statementId: string; contentHash: string }>,
): boolean {
  if (snapshot.length !== current.length) return true;
  const m = new Map(snapshot.map((s) => [s.statementId, s.contentHash]));
  for (const c of current) {
    if (m.get(c.statementId) !== c.contentHash) return true;
  }
  return false;
}
