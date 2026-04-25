"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Party = "plaintiff" | "defendant";
type Role =
  | "party_witness"
  | "expert"
  | "opposing_party"
  | "third_party"
  | "custodian"
  | "other";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "party_witness", label: "Party witness" },
  { value: "expert", label: "Expert witness" },
  { value: "opposing_party", label: "Opposing party" },
  { value: "third_party", label: "Third-party witness" },
  { value: "custodian", label: "Records custodian" },
  { value: "other", label: "Other" },
];

export function NewDepositionOutlineDialog({
  caseId,
  onClose,
}: {
  caseId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [servingParty, setServingParty] = useState<Party>("plaintiff");
  const [deponentName, setDeponentName] = useState("");
  const [deponentRole, setDeponentRole] = useState<Role>("party_witness");
  const [scheduledDate, setScheduledDate] = useState("");
  const [location, setLocation] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [title, setTitle] = useState("");

  const computedTitle = deponentName.trim()
    ? `Deposition Outline for ${deponentName.trim()} — Initial`
    : "";
  const effectiveTitle = titleEdited ? title : computedTitle;

  const create = trpc.depositionPrep.createOutline.useMutation({
    onSuccess: ({ id }) => {
      toast.success("Deposition outline created");
      utils.depositionPrep.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}/trial-prep/depositions/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = () => {
    if (!deponentName.trim()) {
      toast.error("Deponent name is required");
      return;
    }
    create.mutate({
      caseId,
      servingParty,
      deponentName: deponentName.trim(),
      deponentRole,
      scheduledDate: scheduledDate || null,
      location: location.trim() || null,
      title: effectiveTitle.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-semibold">New Deposition Outline</h2>

        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">Serving party</legend>
            <div className="mt-2 flex gap-4 text-sm">
              {(["plaintiff", "defendant"] as Party[]).map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="depServingParty"
                    checked={servingParty === p}
                    onChange={() => setServingParty(p)}
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm">
            Deponent name
            <input
              type="text"
              value={deponentName}
              onChange={(e) => setDeponentName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              placeholder="John Smith"
            />
          </label>

          <label className="block text-sm">
            Deponent role
            <select
              value={deponentRole}
              onChange={(e) => setDeponentRole(e.target.value as Role)}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Scheduled date
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              Location
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                placeholder="Optional"
              />
            </label>
          </div>

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
              placeholder="Deposition Outline for [Name] — Initial"
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
            disabled={
              create.isPending ||
              !deponentName.trim() ||
              !effectiveTitle.trim()
            }
            onClick={onSubmit}
            className="rounded-md bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
