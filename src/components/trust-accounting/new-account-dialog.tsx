"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { parseUsdToCents } from "./format";

export function NewTrustAccountDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("Main IOLTA Account");
  const [accountType, setAccountType] = useState<"iolta" | "operating">("iolta");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("FEDERAL");
  const [beginningBalance, setBeginningBalance] = useState("0.00");

  const createMut = trpc.trustAccounting.accounts.create.useMutation({
    onSuccess: async () => {
      toast.success("Trust account created");
      await utils.trustAccounting.accounts.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseUsdToCents(beginningBalance) ?? 0;
    createMut.mutate({
      name: name.trim(),
      accountType,
      bankName: bankName.trim() || null,
      accountNumber: accountNumber.trim() || null,
      routingNumber: routingNumber.trim() || null,
      jurisdiction: jurisdiction.trim().toUpperCase() || "FEDERAL",
      beginningBalanceCents: cents,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Trust Account</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Name *
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Type *
              </label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as "iolta" | "operating")}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              >
                <option value="iolta">IOLTA (Trust)</option>
                <option value="operating">Operating</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Jurisdiction
              </label>
              <input
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Bank name
            </label>
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Account number
              </label>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
                placeholder="encrypted at rest"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Routing number
              </label>
              <input
                value={routingNumber}
                onChange={(e) => setRoutingNumber(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Beginning balance (USD)
            </label>
            <input
              value={beginningBalance}
              onChange={(e) => setBeginningBalance(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Account/routing numbers are encrypted at rest. They cannot be edited
            after creation — to change them, archive this account and create a
            new one.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded bg-blue-600 px-3 py-1.5 font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {createMut.isPending ? "Creating..." : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
