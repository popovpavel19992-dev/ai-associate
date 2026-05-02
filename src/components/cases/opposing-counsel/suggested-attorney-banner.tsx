"use client";

import { useState } from "react";
import { AttorneyAttachDialog } from "./attorney-attach-dialog";

type Suggestion = {
  name?: string;
  firm?: string | null;
  barNumber?: string | null;
  barState?: string | null;
};

interface Props {
  caseId: string;
  doc: {
    id: string;
    filename: string;
    suggestedAttorneyJson?: unknown;
  };
  onAdded?: () => void;
}

/**
 * Small inline banner shown for documents whose signature extractor
 * detected an opposing-counsel signature. Client-side dismissable;
 * dismissal is *not* persisted (banner re-appears on next render until
 * user adds the attorney). Kept simple for v1 — a server-side
 * acknowledge mutation can be added later.
 */
export function SuggestedAttorneyBanner({ caseId, doc, onAdded }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  const sug = doc.suggestedAttorneyJson as Suggestion | null | undefined;
  if (!sug || dismissed) return null;
  const name = sug.name?.trim();
  if (!name) return null;

  return (
    <>
      <div className="flex items-start justify-between gap-3 rounded-md border border-violet-700/60 bg-violet-900/20 px-3 py-2 text-xs text-violet-100">
        <div className="min-w-0">
          <div className="font-medium">
            Detected attorney signature: {name}
            {sug.firm ? ` · ${sug.firm}` : ""}
          </div>
          <div className="truncate text-violet-300/70">
            from {doc.filename}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700"
          >
            Add to case parties
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded border border-violet-700/60 px-2 py-1 text-[11px] hover:bg-violet-900/40"
          >
            Dismiss
          </button>
        </div>
      </div>
      <AttorneyAttachDialog
        open={open}
        onOpenChange={setOpen}
        caseId={caseId}
        initial={{
          name: sug.name ?? "",
          firm: sug.firm ?? "",
          barNumber: sug.barNumber ?? "",
          barState: sug.barState ?? "",
        }}
        onAdded={() => {
          setDismissed(true);
          onAdded?.();
        }}
      />
    </>
  );
}
