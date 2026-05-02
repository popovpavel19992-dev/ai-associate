"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { AttorneyAttachDialog } from "./attorney-attach-dialog";
import { PostureCard } from "./posture-card";
import { SuggestedAttorneyBanner } from "./suggested-attorney-banner";

export function OpposingCounselTab({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const beta = trpc.opposingCounsel.isBetaEnabled.useQuery();
  const list = trpc.opposingCounsel.listAttorneysForCase.useQuery(
    { caseId },
    { enabled: !!beta.data?.enabled },
  );
  const caseQ = trpc.cases.getById.useQuery(
    { caseId },
    { enabled: !!beta.data?.enabled },
  );

  if (beta.isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-zinc-500">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (!beta.data?.enabled) {
    return (
      <div className="m-4 rounded-md border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
        Opposing-counsel response prediction is in private beta. Contact your
        admin to request access for this organization.
      </div>
    );
  }

  const rows = list.data ?? [];
  const selected = rows.find((r) => r.profile?.id === selectedProfileId);

  // Documents with extracted attorney suggestions
  const docs = (caseQ.data?.documents ?? []).filter(
    (d) =>
      d.suggestedAttorneyJson != null &&
      typeof (d.suggestedAttorneyJson as { name?: unknown }).name === "string",
  );

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Opposing Counsel</h2>
          <p className="text-xs text-zinc-500">
            Profiles, posture readouts, and response predictions for opposing
            attorneys on this case.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
        >
          + Add attorney
        </button>
      </div>

      {/* Auto-extracted suggestions */}
      {docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((d) => (
            <SuggestedAttorneyBanner
              key={d.id}
              caseId={caseId}
              doc={{
                id: d.id,
                filename: d.filename,
                suggestedAttorneyJson: d.suggestedAttorneyJson,
              }}
              onAdded={() => list.refetch()}
            />
          ))}
        </div>
      )}

      {/* Attorney list */}
      {list.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" /> Loading attorneys…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
          No opposing counsel attached yet. Click <strong>Add attorney</strong> to
          start.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {rows.map((r) => (
            <li
              key={r.party.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="font-medium text-zinc-100">{r.party.name}</div>
                <div className="truncate text-xs text-zinc-500">
                  {r.profile?.clFirmName ?? r.party.address ?? "—"}
                  {r.profile?.barNumber ? ` · Bar #${r.profile.barNumber}` : ""}
                  {r.profile?.barState ? ` (${r.profile.barState})` : ""}
                  {r.profile?.clPersonId ? " · CourtListener ✓" : ""}
                </div>
              </div>
              <button
                type="button"
                disabled={!r.profile?.id}
                onClick={() => setSelectedProfileId(r.profile!.id)}
                className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
              >
                {r.profile?.id ? "Posture" : "No profile"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedProfileId && selected?.profile?.id && (
        <PostureCard
          caseId={caseId}
          profileId={selectedProfileId}
          attorneyName={selected.party.name}
        />
      )}

      <AttorneyAttachDialog
        open={open}
        onOpenChange={setOpen}
        caseId={caseId}
        onAdded={() => list.refetch()}
      />
    </div>
  );
}
