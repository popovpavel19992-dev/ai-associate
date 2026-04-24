"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Method = "cm_ecf" | "mail" | "hand_delivery" | "email" | "fax";

const COURTS = [
  "S.D.N.Y.",
  "E.D.N.Y.",
  "D.D.C.",
  "N.D. Cal.",
  "C.D. Cal.",
  "N.D. Ill.",
  "E.D. Va.",
  "D. Mass.",
];

export function SubmissionModal({
  motionId,
  packageId,
  open,
  onClose,
  onCreated,
}: {
  caseId: string;
  motionId?: string;
  packageId?: string;
  open: boolean;
  onClose: () => void;
  onCreated: (filingId: string) => void;
}) {
  const [confirmationNumber, setConfirmationNumber] = React.useState("");
  const [court, setCourt] = React.useState("");
  const [judgeName, setJudgeName] = React.useState("");
  const [submissionMethod, setSubmissionMethod] = React.useState<Method>("cm_ecf");
  const [feeDollars, setFeeDollars] = React.useState("0");
  const [submittedAt, setSubmittedAt] = React.useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setConfirmationNumber("");
      setCourt("");
      setJudgeName("");
      setSubmissionMethod("cm_ecf");
      setFeeDollars("0");
      setSubmittedAt(new Date().toISOString().slice(0, 16));
      setNotes("");
    }
  }, [open]);

  const create = trpc.filings.create.useMutation({
    onSuccess: (res) => {
      toast.success("Filing recorded");
      if (res.warning) toast.warning(res.warning);
      onCreated(res.filing.id);
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const feeCents = Math.round(parseFloat(feeDollars) * 100);
    if (!Number.isFinite(feeCents) || feeCents < 0) {
      toast.error("Invalid fee");
      return;
    }
    create.mutate({
      motionId,
      packageId,
      confirmationNumber: confirmationNumber.trim(),
      court: court.trim(),
      judgeName: judgeName.trim() || undefined,
      submissionMethod,
      feePaidCents: feeCents,
      submittedAt: new Date(submittedAt).toISOString(),
      notes: notes.trim() || undefined,
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-md bg-white p-6 space-y-3"
      >
        <h2 className="text-lg font-semibold">Record court filing</h2>
        <p className="text-xs text-gray-500">
          Records submission metadata — does not transmit the package. File
          manually via CM/ECF, then enter the confirmation details.
        </p>

        <label className="block">
          <span className="text-sm font-medium">Confirmation number</span>
          <input
            required
            type="text"
            value={confirmationNumber}
            onChange={(e) => setConfirmationNumber(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="e.g. 24-cv-12345"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Court</span>
          <input
            required
            list="filings-court-suggest"
            value={court}
            onChange={(e) => setCourt(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="S.D.N.Y."
          />
          <datalist id="filings-court-suggest">
            {COURTS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Judge (optional)</span>
          <input
            value={judgeName}
            onChange={(e) => setJudgeName(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Submission method</span>
          <select
            value={submissionMethod}
            onChange={(e) => setSubmissionMethod(e.target.value as Method)}
            className="mt-1 w-full rounded border px-2 py-1"
          >
            <option value="cm_ecf">CM/ECF</option>
            <option value="mail">Mail</option>
            <option value="hand_delivery">Hand delivery</option>
            <option value="email">Email</option>
            <option value="fax">Fax</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Fee paid ($)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Submitted at</span>
            <input
              required
              type="datetime-local"
              value={submittedAt}
              onChange={(e) => setSubmittedAt(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {create.isPending ? "Saving…" : "Record filing"}
          </button>
        </div>
      </form>
    </div>
  );
}
