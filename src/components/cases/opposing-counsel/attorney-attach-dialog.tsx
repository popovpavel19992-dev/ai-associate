"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  /** Pre-fill values when triggered from a doc-extraction suggestion. */
  initial?: {
    name?: string;
    firm?: string;
    barNumber?: string;
    barState?: string;
  };
  onAdded?: () => void;
}

const INPUT_CLS =
  "w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500";
const LABEL_CLS = "mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400";

export function AttorneyAttachDialog({
  open,
  onOpenChange,
  caseId,
  initial,
  onAdded,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [firm, setFirm] = useState(initial?.firm ?? "");
  const [bar, setBar] = useState(initial?.barNumber ?? "");
  const [state, setState] = useState(initial?.barState ?? "");
  const [busy, setBusy] = useState(false);

  const createParty = trpc.parties.create.useMutation();
  const attach = trpc.opposingCounsel.attachAttorney.useMutation();

  async function submit() {
    if (!name.trim()) {
      toast.error("Attorney name is required.");
      return;
    }
    setBusy(true);
    try {
      const party = await createParty.mutateAsync({
        caseId,
        role: "opposing_counsel",
        name: name.trim(),
      });
      await attach.mutateAsync({
        caseId,
        casePartyId: party.id,
        firm: firm.trim() || null,
        barNumber: bar.trim() || null,
        barState: state.trim() ? state.trim().toUpperCase() : null,
      });
      toast.success("Attorney added");
      onAdded?.();
      onOpenChange(false);
      // reset
      setName("");
      setFirm("");
      setBar("");
      setState("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add attorney";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add opposing counsel</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={LABEL_CLS}>Attorney name *</label>
            <input
              className={INPUT_CLS}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Firm</label>
            <input
              className={INPUT_CLS}
              value={firm}
              onChange={(e) => setFirm(e.target.value)}
              placeholder="Smith &amp; Co LLP"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL_CLS}>Bar #</label>
              <input
                className={INPUT_CLS}
                value={bar}
                onChange={(e) => setBar(e.target.value)}
                placeholder="123456"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Bar state</label>
              <input
                className={INPUT_CLS}
                value={state}
                onChange={(e) => setState(e.target.value.slice(0, 2).toUpperCase())}
                maxLength={2}
                placeholder="CA"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !name.trim()}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
