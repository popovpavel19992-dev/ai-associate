"use client";

import type { Contradiction } from "@/server/db/schema/case-witness-impeachment-scans";

const dot = (sev: string) =>
  sev === "direct" ? "●●●" : sev === "inferred" ? "●●○" : sev === "tangential" ? "●○○" : "";

const SEV_TONE: Record<string, string> = {
  direct: "border-red-500/30",
  inferred: "border-amber-500/30",
  tangential: "border-zinc-500/30",
};

const KIND_LABEL: Record<string, string> = {
  self: "self",
  evidence: "evidence",
};

export function ContradictionsList({
  contradictions,
  filenameByStatementId,
  filenameByDocumentId,
}: {
  contradictions: Contradiction[];
  filenameByStatementId: Map<string, string>;
  filenameByDocumentId: Map<string, string>;
}) {
  if (contradictions.length === 0) {
    return <p className="text-sm text-zinc-500">No contradictions found in this scan.</p>;
  }

  function quoteSource(q: Contradiction["leftQuote"]): string {
    if (q.statementId) return filenameByStatementId.get(q.statementId) ?? "statement";
    if (q.documentId) return filenameByDocumentId.get(q.documentId) ?? "document";
    return "(unknown)";
  }

  return (
    <div className="space-y-3">
      {contradictions.map((c) => (
        <div key={c.id} className={`rounded border p-3 ${SEV_TONE[c.severity] ?? ""}`}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>
              <span className="uppercase tracking-wide">{c.severity}</span>
              <span className="ml-1">{dot(c.severity)}</span>
              <span className="ml-2 text-xs text-zinc-500">({KIND_LABEL[c.kind]})</span>
            </span>
          </div>
          <div className="text-sm">{c.summary}</div>
          <div className="mt-2 space-y-2 text-sm">
            <div>
              <div className="text-xs text-zinc-500">A: {quoteSource(c.leftQuote)} {c.leftQuote.locator ?? ""}</div>
              <div className="italic text-zinc-300">&quot;{c.leftQuote.text}&quot;</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">B: {quoteSource(c.rightQuote)} {c.rightQuote.locator ?? ""}</div>
              <div className="italic text-zinc-300">&quot;{c.rightQuote.text}&quot;</div>
            </div>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-zinc-400">Suggested impeachment questions</summary>
            <ul className="mt-1 space-y-1 text-sm">
              {c.impeachmentQuestions.map((q, i) => (<li key={i}>→ {q}</li>))}
            </ul>
          </details>
        </div>
      ))}
    </div>
  );
}
