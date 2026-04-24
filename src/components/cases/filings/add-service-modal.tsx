"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Method = "cm_ecf_nef" | "email" | "mail" | "certified_mail" | "overnight" | "hand_delivery" | "fax";
type Role = "opposing_counsel" | "co_defendant" | "co_plaintiff" | "pro_se" | "third_party" | "witness" | "other";

const METHOD_OPTIONS: Array<[Method, string]> = [
  ["cm_ecf_nef", "CM/ECF (Notice of Electronic Filing)"],
  ["email", "Email"],
  ["mail", "First-class mail"],
  ["certified_mail", "Certified mail (return receipt)"],
  ["overnight", "Overnight courier"],
  ["hand_delivery", "Hand delivery"],
  ["fax", "Fax"],
];

const TRACKING_METHODS = new Set<Method>(["certified_mail", "overnight", "fax"]);

const ROLE_OPTIONS: Array<[Role, string]> = [
  ["opposing_counsel", "Opposing Counsel"],
  ["co_defendant", "Co-Defendant"],
  ["co_plaintiff", "Co-Plaintiff"],
  ["pro_se", "Pro Se Party"],
  ["third_party", "Third Party"],
  ["witness", "Witness"],
  ["other", "Other"],
];

export function AddServiceModal({
  open,
  caseId,
  filingId,
  onClose,
  onCreated,
}: {
  open: boolean;
  caseId: string;
  filingId: string;
  onClose: () => void;
  onCreated: (result: {
    serviceId: string;
    mailRuleApplicable: boolean;
    affectedDeadlines: Array<{ deadlineId: string; title: string; currentDue: string; proposedDue: string }>;
  }) => void;
}) {
  const utils = trpc.useUtils();
  const { data: unserved } = trpc.services.listUnservedParties.useQuery({ filingId }, { enabled: open });

  const [partyId, setPartyId] = React.useState<string>("");
  const [method, setMethod] = React.useState<Method>("cm_ecf_nef");
  const [servedAt, setServedAt] = React.useState(() => new Date().toISOString().slice(0, 16));
  const [trackingReference, setTrackingReference] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // Inline new-party form
  const [showNewParty, setShowNewParty] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState<Role>("opposing_counsel");
  const [newEmail, setNewEmail] = React.useState("");
  const [newAddress, setNewAddress] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setPartyId("");
      setMethod("cm_ecf_nef");
      setServedAt(new Date().toISOString().slice(0, 16));
      setTrackingReference("");
      setNotes("");
      setShowNewParty(false);
      setNewName("");
      setNewRole("opposing_counsel");
      setNewEmail("");
      setNewAddress("");
    }
  }, [open]);

  const createParty = trpc.parties.create.useMutation({
    onSuccess: async (party) => {
      toast.success(`Party "${party.name}" added`);
      await utils.services.listUnservedParties.invalidate({ filingId });
      await utils.parties.listByCase.invalidate({ caseId });
      setPartyId(party.id);
      setShowNewParty(false);
      setNewName("");
      setNewEmail("");
      setNewAddress("");
    },
    onError: (e) => toast.error(e.message),
  });

  const createService = trpc.services.create.useMutation({
    onSuccess: async (res) => {
      toast.success("Service recorded");
      await utils.services.listByFiling.invalidate({ filingId });
      await utils.services.listUnservedParties.invalidate({ filingId });
      onCreated({
        serviceId: res.service.id,
        mailRuleApplicable: res.mailRuleApplicable,
        affectedDeadlines: res.affectedDeadlines,
      });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) {
      toast.error("Pick a party or add a new one");
      return;
    }
    createService.mutate({
      filingId,
      partyId,
      method,
      servedAt: new Date(servedAt).toISOString(),
      trackingReference: trackingReference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  function handleCreateParty(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error("Party name required");
      return;
    }
    createParty.mutate({
      caseId,
      name: newName.trim(),
      role: newRole,
      email: newEmail.trim() || undefined,
      address: newAddress.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-md bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold">Add service record</h2>

        {!showNewParty ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Party served</span>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              >
                <option value="">Select party…</option>
                {(unserved ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {ROLE_OPTIONS.find(([r]) => r === p.role)?.[1] ?? p.role}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewParty(true)}
                className="mt-1 text-xs text-blue-600 hover:underline"
              >
                + Add new party
              </button>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
                className="mt-1 w-full rounded border px-2 py-1"
              >
                {METHOD_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Served at</span>
              <input
                required
                type="datetime-local"
                value={servedAt}
                onChange={(e) => setServedAt(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>

            {TRACKING_METHODS.has(method) && (
              <label className="block">
                <span className="text-sm font-medium">Tracking reference</span>
                <input
                  type="text"
                  value={trackingReference}
                  onChange={(e) => setTrackingReference(e.target.value)}
                  placeholder="Receipt # / tracking #"
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
            )}

            <label className="block">
              <span className="text-sm font-medium">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">Cancel</button>
              <button
                type="submit"
                disabled={createService.isPending}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {createService.isPending ? "Recording…" : "Record service"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreateParty} className="space-y-3 rounded border p-3 bg-gray-50">
            <h3 className="text-sm font-semibold">New party</h3>
            <label className="block">
              <span className="text-sm">Name</span>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-sm">Role</span>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="mt-1 w-full rounded border px-2 py-1"
              >
                {ROLE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm">Email</span>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-sm">Address</span>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowNewParty(false)} className="rounded border px-3 py-1 text-sm">Cancel</button>
              <button type="submit" disabled={createParty.isPending} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">
                {createParty.isPending ? "Saving…" : "Save party"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
