"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type SessionType = "initial" | "continued" | "final";

export function NewMediationSessionDialog({
  caseId,
  onClose,
}: {
  caseId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [mediatorName, setMediatorName] = useState("");
  const [mediatorFirm, setMediatorFirm] = useState("");
  const [mediatorEmail, setMediatorEmail] = useState("");
  const [mediatorPhone, setMediatorPhone] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [location, setLocation] = useState("");
  const [sessionType, setSessionType] = useState<SessionType>("initial");
  const [notes, setNotes] = useState("");

  const createMut = trpc.settlement.mediation.create.useMutation({
    onSuccess: async (out) => {
      toast.success(`Mediation session #${out.sessionNumber} scheduled`);
      await utils.settlement.mediation.listForCase.invalidate({ caseId });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mediatorName.trim()) {
      toast.error("Mediator name is required");
      return;
    }
    if (!scheduledDate) {
      toast.error("Scheduled date is required");
      return;
    }
    createMut.mutate({
      caseId,
      mediatorName: mediatorName.trim(),
      mediatorFirm: mediatorFirm.trim() || null,
      mediatorEmail: mediatorEmail.trim() || null,
      mediatorPhone: mediatorPhone.trim() || null,
      scheduledDate: new Date(scheduledDate).toISOString(),
      location: location.trim() || null,
      sessionType,
      notes: notes.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Schedule Mediation</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Mediator Name *
              </label>
              <input
                value={mediatorName}
                onChange={(e) => setMediatorName(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Mediator Firm
              </label>
              <input
                value={mediatorFirm}
                onChange={(e) => setMediatorFirm(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Session Type
              </label>
              <select
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value as SessionType)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              >
                <option value="initial">Initial</option>
                <option value="continued">Continued</option>
                <option value="final">Final</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Email
              </label>
              <input
                value={mediatorEmail}
                onChange={(e) => setMediatorEmail(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Phone
              </label>
              <input
                value={mediatorPhone}
                onChange={(e) => setMediatorPhone(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Scheduled Date *
              </label>
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Location
              </label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="JAMS Center, 123 Main St., NY (or Zoom link)"
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {createMut.isPending ? "Saving…" : "Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
