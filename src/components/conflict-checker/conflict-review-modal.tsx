// src/components/conflict-checker/conflict-review-modal.tsx
//
// Phase 3.6 — Conflict review modal.
//
// Renders the hits returned by `conflictChecker.runCheck`, lets the lawyer
// either Cancel or Override + Continue. Override requires a textual reason.
"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface ReviewHit {
  source: string;
  matchedName: string;
  matchedValue: string;
  severity: Severity;
  similarity: number;
  matchType: string;
  caseId?: string;
  caseName?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hits: ReviewHit[];
  highestSeverity: Severity | null;
  onCancel: () => void;
  onOverride: (reason: string) => void | Promise<void>;
  isOverriding?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  client: "Existing client",
  opposing_party: "Opposing party",
  opposing_counsel: "Opposing counsel",
  witness: "Witness",
  subpoena_recipient: "Subpoena recipient",
  mediator: "Mediator",
  demand_recipient: "Demand letter recipient",
};

function severityIcon(s: Severity) {
  if (s === "HIGH") return <AlertOctagon className="h-4 w-4 text-red-500" />;
  if (s === "MEDIUM") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
}

function severityBadge(s: Severity) {
  const cls =
    s === "HIGH"
      ? "bg-red-500/15 text-red-500 border-red-500/30"
      : s === "MEDIUM"
        ? "bg-yellow-500/15 text-yellow-500 border-yellow-500/30"
        : "bg-blue-500/15 text-blue-500 border-blue-500/30";
  return (
    <Badge variant="outline" className={cls}>
      {s}
    </Badge>
  );
}

export function ConflictReviewModal({
  open,
  onOpenChange,
  hits,
  highestSeverity,
  onCancel,
  onOverride,
  isOverriding,
}: Props) {
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  const grouped: Record<Severity, ReviewHit[]> = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const h of hits) grouped[h.severity].push(h);

  const handleCancel = () => {
    setReason("");
    setShowReason(false);
    onCancel();
  };

  const handleOverride = async () => {
    if (reason.trim().length < 3) return;
    await onOverride(reason.trim());
    setReason("");
    setShowReason(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {highestSeverity && severityIcon(highestSeverity)}
            Potential Conflict of Interest
          </DialogTitle>
          <DialogDescription>
            {hits.length} potential {hits.length === 1 ? "match" : "matches"} found
            across firm records. Review before proceeding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(["HIGH", "MEDIUM", "LOW"] as const).map((sev) =>
            grouped[sev].length === 0 ? null : (
              <div key={sev} className="space-y-2">
                <div className="flex items-center gap-2">
                  {severityIcon(sev)}
                  <h4 className="text-sm font-semibold">
                    {sev === "HIGH"
                      ? "Exact matches"
                      : sev === "MEDIUM"
                        ? "Likely matches"
                        : "Possible matches"}
                  </h4>
                  {severityBadge(sev)}
                  <span className="text-xs text-muted-foreground">
                    ({grouped[sev].length})
                  </span>
                </div>
                <ul className="space-y-2">
                  {grouped[sev].map((h, i) => (
                    <li
                      key={`${sev}-${i}`}
                      className="rounded-md border bg-muted/30 p-3 text-sm"
                    >
                      <div className="font-medium">{h.matchedValue}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          Source:{" "}
                          <span className="font-medium">
                            {SOURCE_LABELS[h.source] ?? h.source}
                          </span>
                        </span>
                        {h.caseName && (
                          <span>
                            Case: <span className="font-medium">{h.caseName}</span>
                          </span>
                        )}
                        <span>Match: {h.matchType.replace("_", " ")}</span>
                        <span>
                          Similarity: {(h.similarity * 100).toFixed(0)}%
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>

        {showReason && (
          <div className="space-y-2">
            <Label htmlFor="override-reason">Override reason (required)</Label>
            <Textarea
              id="override-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why proceeding despite the conflict is appropriate (e.g., informed waiver obtained, unrelated matter, etc.)."
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">
              This reason is recorded permanently in the conflict log audit trail.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isOverriding}>
            Cancel
          </Button>
          {!showReason ? (
            <Button
              variant="destructive"
              onClick={() => setShowReason(true)}
              disabled={isOverriding}
            >
              Override and Continue
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={handleOverride}
              disabled={reason.trim().length < 3 || isOverriding}
            >
              {isOverriding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Override
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
