"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X } from "lucide-react";

type MergedRow = {
  userId: string;
  userName: string;
  rateCents: number;
  hasRate: boolean;
};

export function BillingRatesTable() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.billingRates.list.useQuery();
  const { data: members = [], isLoading: membersLoading } = trpc.team.list.useQuery();
  const upsert = trpc.billingRates.upsert.useMutation({
    onSuccess: () => {
      utils.billingRates.list.invalidate();
      toast.success("Rate updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function startEdit(userId: string, currentCents: number) {
    setEditId(userId);
    setEditValue((currentCents / 100).toFixed(2));
  }

  function cancelEdit() {
    setEditId(null);
    setEditValue("");
  }

  async function saveEdit(userId: string) {
    const rateCents = Math.round(parseFloat(editValue || "0") * 100);
    await upsert.mutateAsync({ userId, rateCents });
    setEditId(null);
    setEditValue("");
  }

  if (isLoading || membersLoading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>;
  }

  const rates = data?.rates ?? [];
  const defaultRates = rates.filter((r) => r.caseId === null);

  // Merge: show all team members, with their rate if it exists
  const rateMap = new Map(defaultRates.map((r) => [r.userId, r]));
  const rows: MergedRow[] = members.map((m) => {
    const existing = rateMap.get(m.id);
    return {
      userId: m.id,
      userName: m.name ?? m.email ?? "Unknown",
      rateCents: existing?.rateCents ?? 0,
      hasRate: !!existing,
    };
  });

  // If solo user (no team members from team.list), show self from rates if available
  if (rows.length === 0 && defaultRates.length > 0) {
    for (const rate of defaultRates) {
      rows.push({
        userId: rate.userId,
        userName: rate.userName ?? "You",
        rateCents: rate.rateCents,
        hasRate: true,
      });
    }
  }

  // Solo user with no team and no rates — show a message with a way to set own rate
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No team members found. Billing rates will appear here once you have team members or create time entries.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Team Member</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Default Rate ($/hr)</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
              <td className="px-4 py-3 text-zinc-300">{row.userName}</td>
              <td className="px-4 py-3 text-right">
                {editId === row.userId ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="ml-auto h-7 w-28 bg-zinc-800 border-zinc-700 text-zinc-200 text-right text-sm"
                    autoFocus
                  />
                ) : (
                  <span className={`font-medium ${row.hasRate ? "text-zinc-200" : "text-zinc-500"}`}>
                    {row.hasRate ? formatCents(row.rateCents) : "Not set"}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {editId === row.userId ? (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-emerald-400 hover:text-emerald-300"
                      onClick={() => saveEdit(row.userId)}
                      disabled={upsert.isPending}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
                      onClick={cancelEdit}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
                    onClick={() => startEdit(row.userId, row.rateCents)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
