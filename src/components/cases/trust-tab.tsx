// src/components/cases/trust-tab.tsx
//
// Phase 3.8 — Per-case Trust tab.
// Owner/admin only. Shows the case client's running trust balance plus
// recent trust transactions tagged to this case. Quick-access deposit /
// disbursement buttons that open the same dialogs used in Settings.
"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  formatUsd,
  formatTxnDate,
  TXN_TYPE_LABELS,
} from "@/components/trust-accounting/format";
import {
  NewDepositDialog,
  NewDisbursementDialog,
} from "@/components/trust-accounting/transaction-dialogs";

export function TrustTab({
  caseId,
  clientId,
}: {
  caseId: string;
  clientId: string | null;
}) {
  const { data: profile } = trpc.users.getProfile.useQuery();
  const isAllowed = profile?.role === "owner" || profile?.role === "admin";

  const { data: accounts } = trpc.trustAccounting.accounts.list.useQuery(
    { includeInactive: false },
    { enabled: !!isAllowed },
  );
  const ioltaAccounts = (accounts ?? []).filter((a) => a.accountType === "iolta");
  const [accountId, setAccountId] = useState<string | null>(null);
  const effectiveAccountId =
    accountId ?? (ioltaAccounts[0]?.id ?? null);

  const { data: balance } = trpc.trustAccounting.balances.getClient.useQuery(
    {
      accountId: effectiveAccountId ?? "",
      clientId: clientId ?? "",
    },
    { enabled: !!effectiveAccountId && !!clientId && !!isAllowed },
  );

  const { data: txns } = trpc.trustAccounting.transactions.list.useQuery(
    { accountId: effectiveAccountId ?? "", caseId, includeVoided: true },
    { enabled: !!effectiveAccountId && !!isAllowed },
  );

  const [showDeposit, setShowDeposit] = useState(false);
  const [showDisbursement, setShowDisbursement] = useState(false);

  if (!isAllowed) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-200">
          <ShieldAlert className="mb-1 inline size-4" /> Trust accounting is
          restricted to firm owners and admins.
        </div>
      </div>
    );
  }

  if (!clientId) {
    return (
      <div className="px-4 py-6 text-sm text-zinc-500">
        Link a client to this case to track trust funds.
      </div>
    );
  }

  if (ioltaAccounts.length === 0) {
    return (
      <div className="px-4 py-6 text-sm">
        <p className="text-zinc-400">
          No active IOLTA accounts. Create one in{" "}
          <Link href="/settings/trust-accounts" className="text-blue-400 hover:underline">
            Settings → Trust Accounts
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Trust</h2>
          <p className="text-xs text-zinc-500">
            Client trust balance and case-tagged transactions.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Client trust balance
          </p>
          <p className="text-2xl font-semibold">
            {balance ? formatUsd(balance.balanceCents) : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={effectiveAccountId ?? ""}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
        >
          {ioltaAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowDeposit(true)}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
        >
          Record Deposit
        </button>
        <button
          onClick={() => setShowDisbursement(true)}
          className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium hover:bg-rose-500"
        >
          Record Disbursement
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {(txns ?? []).length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No transactions tagged to this case yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(txns ?? []).map((t) => (
                <tr
                  key={t.id}
                  className={`border-b border-zinc-900 last:border-b-0 ${
                    t.voidedAt ? "opacity-50 line-through" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-zinc-400">
                    {formatTxnDate(t.transactionDate as unknown as string)}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {TXN_TYPE_LABELS[t.transactionType] ?? t.transactionType}
                  </td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className="px-3 py-2 text-right">{formatUsd(t.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showDeposit && effectiveAccountId ? (
        <NewDepositDialog
          accountId={effectiveAccountId}
          defaultClientId={clientId}
          defaultCaseId={caseId}
          onClose={() => setShowDeposit(false)}
        />
      ) : null}
      {showDisbursement && effectiveAccountId ? (
        <NewDisbursementDialog
          accountId={effectiveAccountId}
          defaultClientId={clientId}
          defaultCaseId={caseId}
          onClose={() => setShowDisbursement(false)}
        />
      ) : null}
    </div>
  );
}
