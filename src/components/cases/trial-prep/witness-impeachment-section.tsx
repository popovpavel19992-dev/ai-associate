"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { AttachStatementsDialog } from "./attach-statements-dialog";
import { ContradictionsList } from "./contradictions-list";
import type {
  Contradiction,
  StatementSnapshot,
} from "@/server/db/schema/case-witness-impeachment-scans";

const dot = (l?: string | null) =>
  l === "high" ? "●●●" : l === "med" ? "●●○" : l === "low" ? "●○○" : "";

function parseErr(message: string): { kind?: string; filenames?: string[] } | null {
  try {
    return JSON.parse(message) as never;
  } catch {
    return null;
  }
}

export function WitnessImpeachmentSection(props: {
  caseId: string;
  witnessId: string;
  betaEnabled: boolean;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const utils = trpc.useUtils();
  const stmtsQ = trpc.witnessImpeachment.listStatementsForWitness.useQuery(
    { caseId: props.caseId, witnessId: props.witnessId },
    { enabled: props.betaEnabled },
  );
  const scanQ = trpc.witnessImpeachment.getScan.useQuery(
    { caseId: props.caseId, witnessId: props.witnessId },
    { enabled: props.betaEnabled },
  );
  const detach = trpc.witnessImpeachment.detachStatement.useMutation({
    onSuccess: () => {
      utils.witnessImpeachment.listStatementsForWitness.invalidate({
        caseId: props.caseId,
        witnessId: props.witnessId,
      });
    },
  });
  const runScan = trpc.witnessImpeachment.runScan.useMutation({
    onSuccess: () => {
      utils.witnessImpeachment.getScan.invalidate({
        caseId: props.caseId,
        witnessId: props.witnessId,
      });
    },
    onError: (e) => {
      const p = parseErr(e.message);
      if (p?.kind === "notExtracted") {
        alert(
          `Some documents are still extracting: ${(p.filenames ?? []).join(", ")}. Try again later.`,
        );
      } else if (p?.kind === "noStatements") {
        alert("Attach at least one statement first.");
      } else if (p?.kind === "noClaims") {
        alert("No factual claims could be extracted from the attached statements.");
      }
    },
  });

  if (!props.betaEnabled) return null;
  const stmts = stmtsQ.data ?? [];
  const scan = scanQ.data ?? null;

  // Build filename maps for ContradictionsList.
  const filenameByStatementId = new Map<string, string>(
    stmts.map((s) => [s.id, s.filename ?? "Untitled"]),
  );
  // For document-anchored quotes, look in the scan sourcesJson.
  const filenameByDocumentId = new Map<string, string>(
    ((scan?.sourcesJson as Array<{ id: string; title: string }> | null | undefined) ?? []).map(
      (s) => [s.id, s.title],
    ),
  );

  // Staleness: compare scan.statementsSnapshot to current stmts list.
  // We can't recompute contentHash client-side without extractedText, so consider stale
  // when the set of statementIds differs.
  const stale = scan
    ? scan.statementsSnapshot.length !== stmts.length ||
      !scan.statementsSnapshot.every((s: StatementSnapshot) =>
        stmts.some((cur) => cur.id === s.statementId),
      )
    : false;

  return (
    <div className="mt-3 rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Statement Cross-Check (impeachment)</span>
        {scan?.confidenceOverall && (
          <span className="text-xs text-zinc-500">
            confidence: {scan.confidenceOverall} {dot(scan.confidenceOverall)}
          </span>
        )}
      </div>

      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-semibold">Statements ({stmts.length})</span>
          <Button size="sm" variant="secondary" onClick={() => setAttachOpen(true)}>
            + Attach
          </Button>
        </div>
        {stmts.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Attach witness statements (deposition, declaration, etc.) to enable AI cross-check.
          </p>
        ) : (
          <ul className="text-sm">
            {stmts.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1">
                <span>
                  {s.filename}{" "}
                  <span className="text-xs text-zinc-500">
                    ({s.statementKind}
                    {s.statementDate ? ` · ${s.statementDate}` : ""})
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Detach this statement? Existing scan results will become stale.",
                      )
                    ) {
                      detach.mutate({ caseId: props.caseId, statementId: s.id });
                    }
                  }}
                >
                  Detach
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {stmts.length > 0 && !scan && (
        <Button
          onClick={() => runScan.mutate({ caseId: props.caseId, witnessId: props.witnessId })}
          disabled={runScan.isPending}
        >
          {runScan.isPending ? "Scanning…" : "Run cross-check (4 credits)"}
        </Button>
      )}

      {scan && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>
              Last scan: {new Date(scan.createdAt).toLocaleString()} ·{" "}
              {(scan.contradictionsJson as Contradiction[]).length} contradictions
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={runScan.isPending}
              onClick={() =>
                runScan.mutate({
                  caseId: props.caseId,
                  witnessId: props.witnessId,
                  regenerate: true,
                })
              }
            >
              Re-scan (4cr)
            </Button>
          </div>
          {stale && (
            <div className="rounded border border-amber-500/30 p-2 text-xs text-amber-400">
              ⚠ Statements changed since last scan — re-scan for fresh results.
            </div>
          )}
          <ContradictionsList
            contradictions={scan.contradictionsJson as Contradiction[]}
            filenameByStatementId={filenameByStatementId}
            filenameByDocumentId={filenameByDocumentId}
          />
          <details>
            <summary className="cursor-pointer text-xs text-zinc-400">Reasoning</summary>
            <article className="prose prose-sm whitespace-pre-wrap">{scan.reasoningMd}</article>
          </details>
        </div>
      )}

      <AttachStatementsDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        caseId={props.caseId}
        witnessId={props.witnessId}
      />
    </div>
  );
}
