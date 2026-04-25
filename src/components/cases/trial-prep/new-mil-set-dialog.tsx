"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Party = "plaintiff" | "defendant";

const ORDINAL: Record<number, string> = {
  1: "First Set of",
  2: "Second Set of",
  3: "Third Set of",
  4: "Fourth Set of",
  5: "Fifth Set of",
};

function defaultTitle(party: Party, n: number): string {
  const partyLabel = party === "plaintiff" ? "Plaintiff" : "Defendant";
  const adj = ORDINAL[n] ?? `${n}th Set of`;
  return `${partyLabel}'s ${adj} Motions in Limine`;
}

export function NewMilSetDialog({
  caseId,
  onClose,
}: {
  caseId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [servingParty, setServingParty] = useState<Party>("plaintiff");
  const [titleEdited, setTitleEdited] = useState(false);
  const [title, setTitle] = useState("");

  const { data: nextNumber } = trpc.motionsInLimine.getNextSetNumber.useQuery({
    caseId,
    servingParty,
  });

  const computedTitle = useMemo(() => {
    if (!nextNumber) return "";
    return defaultTitle(servingParty, nextNumber.setNumber);
  }, [servingParty, nextNumber]);

  const effectiveTitle = titleEdited ? title : computedTitle;

  const create = trpc.motionsInLimine.createSet.useMutation({
    onSuccess: ({ id }) => {
      toast.success("Motions in Limine set created");
      utils.motionsInLimine.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}/trial-prep/motions-in-limine/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = () => {
    create.mutate({
      caseId,
      servingParty,
      title: effectiveTitle.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">New Motions in Limine Set</h2>

        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">Serving party</legend>
            <div className="mt-2 flex gap-4 text-sm">
              {(["plaintiff", "defendant"] as Party[]).map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="milServingParty"
                    checked={servingParty === p}
                    onChange={() => setServingParty(p)}
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm">
            Title
            <input
              type="text"
              value={effectiveTitle}
              onChange={(e) => {
                setTitleEdited(true);
                setTitle(e.target.value);
              }}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="Plaintiff's Motions in Limine — First Set"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={create.isPending || !effectiveTitle}
            onClick={onSubmit}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
