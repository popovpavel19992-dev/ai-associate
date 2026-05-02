"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { PredictionTargetKind } from "@/server/db/schema/opposing-counsel-predictions";
import { PredictionDialog } from "./prediction-dialog";

interface Props {
  caseId: string;
  kind: PredictionTargetKind;
  targetId: string;
  targetTitle: string;
  targetBody: string;
  /** When false, the button is hidden (used for non-saved drafts). */
  enabled?: boolean;
}

/**
 * Single shared inline button for all three drafters
 * (Motion, Demand Letter, Discovery Response). Beta-gated via
 * `opposingCounsel.isBetaEnabled` server query — non-beta orgs see nothing.
 */
export function PredictResponseButton({
  caseId,
  kind,
  targetId,
  targetTitle,
  targetBody,
  enabled = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const beta = trpc.opposingCounsel.isBetaEnabled.useQuery();

  if (!beta.data?.enabled) return null;
  if (!enabled || !targetId || !targetBody) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-violet-700 bg-violet-900/40 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-900/70"
      >
        ✨ Predict opposing response
      </button>
      <PredictionDialog
        open={open}
        onOpenChange={setOpen}
        caseId={caseId}
        targetKind={kind}
        targetId={targetId}
        targetTitle={targetTitle}
        targetBody={targetBody}
      />
    </>
  );
}
