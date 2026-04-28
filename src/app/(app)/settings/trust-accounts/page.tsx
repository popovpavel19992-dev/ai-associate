// src/app/(app)/settings/trust-accounts/page.tsx
//
// Phase 3.8 — Trust Accounts list page (Settings → Trust Accounts).
// Owner/admin-only. Members see a "permission required" message.

"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Building2, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { NewTrustAccountDialog } from "@/components/trust-accounting/new-account-dialog";
import { formatUsd } from "@/components/trust-accounting/format";

export default function TrustAccountsPage() {
  const [creating, setCreating] = useState(false);
  const { data: profile, isLoading: profileLoading } = trpc.users.getProfile.useQuery();
  const isAllowed = profile?.role === "owner" || profile?.role === "admin";

  const { data: accounts, isLoading } = trpc.trustAccounting.accounts.list.useQuery(
    { includeInactive: true },
    { enabled: !!isAllowed },
  );

  if (profileLoading) {
    return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  }
  if (!isAllowed) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-6 text-amber-200">
          <ShieldAlert className="mb-2 size-6" />
          <h1 className="text-lg font-semibold">Restricted</h1>
          <p className="mt-2 text-sm">
            Trust accounting is only accessible to firm owners and admins.
            Contact your firm administrator if you need access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trust Accounts</h1>
          <p className="mt-1 text-sm text-zinc-400">
            IOLTA and operating accounts. Strict separation enforced —
            never-negative per-client balances and append-only ledger.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500"
        >
          <Plus className="size-4" /> New account
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading accounts…</p>
      ) : (accounts ?? []).length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-8 text-center text-sm text-zinc-400">
          No trust accounts yet. Create your first account to start tracking
          client trust funds.
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Bank</th>
                <th className="px-4 py-2.5">Jurisdiction</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {(accounts ?? []).map((a) => (
                <tr key={a.id} className="border-b border-zinc-900 last:border-b-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/settings/trust-accounts/${a.id}`}
                      className="flex items-center gap-2 font-medium hover:text-blue-400"
                    >
                      <Building2 className="size-4 text-zinc-500" />
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 uppercase text-zinc-400">
                    {a.accountType}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {a.bankName ?? "—"}
                    {a.accountNumberMasked ? (
                      <span className="ml-2 text-xs text-zinc-500">
                        {a.accountNumberMasked}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{a.jurisdiction}</td>
                  <td className="px-4 py-3">
                    {a.isActive ? (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
                        Active
                      </span>
                    ) : (
                      <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-xs text-zinc-400">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/settings/trust-accounts/${a.id}`}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Real-world deployment: confirm your state bar&apos;s IOLTA rules before
        relying on this module for compliance reporting.
      </p>

      {creating ? <NewTrustAccountDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
