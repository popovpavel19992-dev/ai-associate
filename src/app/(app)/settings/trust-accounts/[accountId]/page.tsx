// src/app/(app)/settings/trust-accounts/[accountId]/page.tsx
//
// Phase 3.8 — Trust Account detail page.
// Tabs: Transactions | Reconciliations
"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatUsd, formatTxnDate, TXN_TYPE_LABELS } from "@/components/trust-accounting/format";
import {
  NewDepositDialog,
  NewDisbursementDialog,
  NewReconciliationDialog,
  VoidTransactionDialog,
} from "@/components/trust-accounting/transaction-dialogs";

type Tab = "transactions" | "reconciliations" | "balances";

export default function TrustAccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);
  const [tab, setTab] = useState<Tab>("transactions");
  const [showDeposit, setShowDeposit] = useState(false);
  const [showDisbursement, setShowDisbursement] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const { data: profile } = trpc.users.getProfile.useQuery();
  const isAllowed = profile?.role === "owner" || profile?.role === "admin";

  const { data: account } = trpc.trustAccounting.accounts.get.useQuery(
    { accountId },
    { enabled: !!isAllowed },
  );
  const { data: balance } = trpc.trustAccounting.balances.getAccount.useQuery(
    { accountId },
    { enabled: !!isAllowed },
  );
  const { data: clientBalances } = trpc.trustAccounting.balances.getAllClients.useQuery(
    { accountId },
    { enabled: !!isAllowed },
  );
  const { data: txns, isLoading: txnsLoading } = trpc.trustAccounting.transactions.list.useQuery(
    { accountId, includeVoided: true },
    { enabled: !!isAllowed },
  );
  const { data: recons } = trpc.trustAccounting.reconciliation.list.useQuery(
    { accountId },
    { enabled: !!isAllowed && tab === "reconciliations" },
  );

  if (!isAllowed) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-sm text-amber-300">
        Trust accounting is restricted to firm owners and admins.
      </div>
    );
  }

  if (!account) {
    return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <Link
        href="/settings/trust-accounts"
        className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-3" /> All trust accounts
      </Link>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{account.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
            <span className="uppercase">{account.accountType}</span>
            <span>Jurisdiction: {account.jurisdiction}</span>
            {account.bankName ? <span>{account.bankName}</span> : null}
            {account.accountNumberMasked ? (
              <span>Acct: {account.accountNumberMasked}</span>
            ) : null}
            {account.routingNumberMasked ? (
              <span>Routing: {account.routingNumberMasked}</span>
            ) : null}
            {!account.isActive ? (
              <span className="text-amber-400">Archived</span>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Current balance
          </p>
          <p className="text-3xl font-semibold">
            {balance ? formatUsd(balance.balanceCents) : "—"}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
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
        <button
          onClick={() => setShowRecon(true)}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          New Reconciliation
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        {([
          ["transactions", "Transactions"],
          ["balances", "Client balances"],
          ["reconciliations", "Reconciliations"],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`border-b-2 px-4 py-2 text-sm ${
              tab === k
                ? "border-white font-medium text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "transactions" && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          {txnsLoading ? (
            <p className="p-4 text-sm text-zinc-500">Loading transactions…</p>
          ) : (txns ?? []).length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No transactions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Payee/Payor</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2"></th>
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
                    <td className="px-3 py-2 text-zinc-400">
                      {t.payeeName ?? t.payorName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatUsd(t.amountCents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!t.voidedAt && !t.voidsTransactionId ? (
                        <button
                          onClick={() => setVoidingId(t.id)}
                          className="text-xs text-rose-400 hover:underline"
                        >
                          Void
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "balances" && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          {(clientBalances ?? []).length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No client balances.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(clientBalances ?? []).map((b) => (
                  <tr key={b.clientId ?? "unalloc"} className="border-b border-zinc-900 last:border-b-0">
                    <td className="px-3 py-2">{b.clientName}</td>
                    <td className="px-3 py-2 text-right">{formatUsd(b.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "reconciliations" && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          {(recons ?? []).length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No reconciliations yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Bank</th>
                  <th className="px-3 py-2 text-right">Book</th>
                  <th className="px-3 py-2 text-right">Ledger sum</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(recons ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-zinc-900 last:border-b-0">
                    <td className="px-3 py-2 text-zinc-300">
                      {new Date(r.periodMonth as unknown as string).toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "matched" ? (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
                          MATCHED
                        </span>
                      ) : r.status === "discrepancy" ? (
                        <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-400">
                          DISCREPANCY
                        </span>
                      ) : (
                        <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-xs text-zinc-400">
                          PENDING
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatUsd(r.bankStatementBalanceCents)}
                    </td>
                    <td className="px-3 py-2 text-right">{formatUsd(r.bookBalanceCents)}</td>
                    <td className="px-3 py-2 text-right">{formatUsd(r.clientLedgerSumCents)}</td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={`/api/trust-reconciliations/${r.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                      >
                        <FileText className="size-3" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showDeposit ? (
        <NewDepositDialog accountId={accountId} onClose={() => setShowDeposit(false)} />
      ) : null}
      {showDisbursement ? (
        <NewDisbursementDialog
          accountId={accountId}
          onClose={() => setShowDisbursement(false)}
        />
      ) : null}
      {showRecon ? (
        <NewReconciliationDialog accountId={accountId} onClose={() => setShowRecon(false)} />
      ) : null}
      {voidingId ? (
        <VoidTransactionDialog
          transactionId={voidingId}
          onClose={() => setVoidingId(null)}
        />
      ) : null}
    </div>
  );
}
