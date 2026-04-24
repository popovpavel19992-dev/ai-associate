"use client";
import * as React from "react";

type Reason = "granted" | "denied" | "withdrawn" | "other";

export function CloseModal({
  open,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: Reason) => void;
  pending: boolean;
}) {
  const [reason, setReason] = React.useState<Reason>("granted");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-md bg-white p-4 space-y-3">
        <h3 className="font-semibold">Close filing</h3>
        <label className="block">
          <span className="text-sm">Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as Reason)}
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          >
            <option value="granted">Granted</option>
            <option value="denied">Denied</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="other">Other</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border px-3 py-1 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(reason)}
            className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {pending ? "Closing…" : "Confirm close"}
          </button>
        </div>
      </div>
    </div>
  );
}
