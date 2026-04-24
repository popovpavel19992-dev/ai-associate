"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CloseModal } from "./close-modal";
import { AddServiceModal } from "./add-service-modal";
import { ApplyMailRuleModal, type AffectedDeadline } from "./apply-mail-rule-modal";
import { PartiesManagerModal } from "./parties-manager-modal";

const METHOD_LABELS: Record<string, string> = {
  cm_ecf: "CM/ECF",
  mail: "Mail",
  hand_delivery: "Hand delivery",
  email: "Email",
  fax: "Fax",
};

export function FilingDetailModal({
  filingId,
  onClose,
  onMutated,
}: {
  filingId: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: filing, isLoading } = trpc.filings.get.useQuery({ filingId });
  const [editing, setEditing] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [addServiceOpen, setAddServiceOpen] = React.useState(false);
  const [partiesManagerOpen, setPartiesManagerOpen] = React.useState(false);
  const [mailRuleModal, setMailRuleModal] = React.useState<{ affected: AffectedDeadline[] } | null>(null);

  const { data: services } = trpc.services.listByFiling.useQuery(
    { filingId },
    { enabled: true },
  );

  const deleteService = trpc.services.delete.useMutation({
    onSuccess: async () => {
      toast.success("Service removed");
      await utils.services.listByFiling.invalidate({ filingId });
    },
    onError: (e) => toast.error(e.message),
  });

  const [confirmationNumber, setConfirmationNumber] = React.useState("");
  const [court, setCourt] = React.useState("");
  const [judgeName, setJudgeName] = React.useState("");
  const [feeDollars, setFeeDollars] = React.useState("0");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (filing) {
      setConfirmationNumber(filing.confirmationNumber);
      setCourt(filing.court);
      setJudgeName(filing.judgeName ?? "");
      setFeeDollars((filing.feePaidCents / 100).toFixed(2));
      setNotes(filing.notes ?? "");
    }
  }, [filing]);

  const update = trpc.filings.update.useMutation({
    onSuccess: async () => {
      toast.success("Filing updated");
      await utils.filings.get.invalidate({ filingId });
      onMutated();
      setEditing(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const closeM = trpc.filings.close.useMutation({
    onSuccess: async () => {
      toast.success("Filing closed");
      await utils.filings.get.invalidate({ filingId });
      onMutated();
      setCloseOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.filings.delete.useMutation({
    onSuccess: () => {
      toast.success("Filing deleted");
      onMutated();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !filing) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded bg-white p-4 text-sm">Loading…</div>
      </div>
    );
  }

  const isClosed = filing.status === "closed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-md bg-white p-6 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Filing #{filing.confirmationNumber}
            </h2>
            <p className="text-xs text-gray-500">
              Status: {filing.status}
              {filing.closedReason && ` · Reason: ${filing.closedReason}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded border px-2 py-1 text-sm"
          >
            Close
          </button>
        </header>

        {!editing ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-gray-600">Court</dt>
            <dd>{filing.court}</dd>
            <dt className="text-gray-600">Judge</dt>
            <dd>{filing.judgeName ?? "—"}</dd>
            <dt className="text-gray-600">Method</dt>
            <dd>
              {METHOD_LABELS[filing.submissionMethod] ?? filing.submissionMethod}
            </dd>
            <dt className="text-gray-600">Fee</dt>
            <dd>${(filing.feePaidCents / 100).toFixed(2)}</dd>
            <dt className="text-gray-600">Submitted at</dt>
            <dd>{new Date(filing.submittedAt).toLocaleString()}</dd>
            {filing.motionId && (
              <>
                <dt className="text-gray-600">Motion</dt>
                <dd>
                  <Link
                    className="text-blue-600 underline"
                    href={`/cases/${filing.caseId}/motions/${filing.motionId}`}
                  >
                    View
                  </Link>
                </dd>
              </>
            )}
            {filing.packageId && filing.motionId && (
              <>
                <dt className="text-gray-600">Package</dt>
                <dd>
                  <Link
                    className="text-blue-600 underline"
                    href={`/cases/${filing.caseId}/motions/${filing.motionId}/package/${filing.packageId}`}
                  >
                    View
                  </Link>
                </dd>
              </>
            )}
            {filing.notes && (
              <>
                <dt className="text-gray-600">Notes</dt>
                <dd className="whitespace-pre-wrap">{filing.notes}</dd>
              </>
            )}
          </dl>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const feeCents = Math.round(parseFloat(feeDollars) * 100);
              update.mutate({
                filingId,
                confirmationNumber,
                court,
                judgeName: judgeName || null,
                feePaidCents: feeCents,
                notes: notes || null,
              });
            }}
            className="space-y-2 text-sm"
          >
            <input
              className="w-full rounded border px-2 py-1"
              value={confirmationNumber}
              onChange={(e) => setConfirmationNumber(e.target.value)}
              placeholder="Confirmation #"
            />
            <input
              className="w-full rounded border px-2 py-1"
              value={court}
              onChange={(e) => setCourt(e.target.value)}
              placeholder="Court"
            />
            <input
              className="w-full rounded border px-2 py-1"
              value={judgeName}
              onChange={(e) => setJudgeName(e.target.value)}
              placeholder="Judge (optional)"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full rounded border px-2 py-1"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
              placeholder="Fee ($)"
            />
            <textarea
              className="w-full rounded border px-2 py-1"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded border px-3 py-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={update.isPending}
                className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
              >
                {update.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}

        {!editing && (
          <section className="rounded-md border border-gray-200 p-3 space-y-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Parties served ({services?.length ?? 0})</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPartiesManagerOpen(true)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Manage case parties
                </button>
                {!isClosed && (
                  <button
                    type="button"
                    onClick={() => setAddServiceOpen(true)}
                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    + Add service
                  </button>
                )}
              </div>
            </header>

            {(!services || services.length === 0) && (
              <p className="text-xs text-gray-500">
                No parties recorded. Add service entries to generate a Certificate of Service.
              </p>
            )}

            {services && services.length > 0 && (
              <>
                <ul className="space-y-1 text-sm">
                  {services.map((s) => (
                    <li key={s.id} className="flex items-start justify-between rounded border p-2">
                      <div>
                        <div className="font-medium">{s.partyName}</div>
                        <div className="text-xs text-gray-600">
                          {s.method} · {new Date(s.servedAt).toLocaleDateString()}
                          {s.trackingReference && ` · #${s.trackingReference}`}
                        </div>
                      </div>
                      {!isClosed && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Remove service for "${s.partyName}"?`)) {
                              deleteService.mutate({ serviceId: s.id });
                            }
                          }}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <a
                  href={`/api/filings/${filingId}/cos`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded border px-3 py-1 text-sm hover:bg-gray-50"
                >
                  Download Certificate of Service
                </a>
              </>
            )}
          </section>
        )}

        {!isClosed && !editing && (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(true)}
              className="rounded border px-3 py-1 text-sm"
            >
              Edit
            </button>
            <button
              onClick={() => setCloseOpen(true)}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white"
            >
              Mark as closed
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this filing?")) del.mutate({ filingId });
              }}
              className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}

        <CloseModal
          open={closeOpen}
          onCancel={() => setCloseOpen(false)}
          onConfirm={(reason) =>
            closeM.mutate({ filingId, closedReason: reason })
          }
          pending={closeM.isPending}
        />

        <AddServiceModal
          open={addServiceOpen}
          caseId={filing.caseId}
          filingId={filingId}
          onClose={() => setAddServiceOpen(false)}
          onCreated={(res) => {
            setAddServiceOpen(false);
            if (res.mailRuleApplicable && res.affectedDeadlines.length > 0) {
              setMailRuleModal({ affected: res.affectedDeadlines });
            }
          }}
        />

        <PartiesManagerModal
          open={partiesManagerOpen}
          caseId={filing.caseId}
          onClose={() => setPartiesManagerOpen(false)}
        />

        {mailRuleModal && (
          <ApplyMailRuleModal
            open
            filingId={filingId}
            caseId={filing.caseId}
            affectedDeadlines={mailRuleModal.affected}
            onClose={() => setMailRuleModal(null)}
          />
        )}
      </div>
    </div>
  );
}
