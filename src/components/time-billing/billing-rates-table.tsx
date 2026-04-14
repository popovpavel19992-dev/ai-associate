"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X } from "lucide-react";

export function BillingRatesTable() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.billingRates.list.useQuery();
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

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>;
  }

  const rates = data?.rates ?? [];

  // Deduplicate to show only default rates (caseId IS NULL) per user
  const defaultRates = rates.filter((r) => r.caseId === null);

  if (defaultRates.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No billing rates configured. Rates are created automatically when time entries are added.
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
          {defaultRates.map((rate) => (
            <tr key={rate.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
              <td className="px-4 py-3 text-zinc-300">{rate.userName}</td>
              <td className="px-4 py-3 text-right">
                {editId === rate.userId ? (
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
                  <span className="font-medium text-zinc-200">{formatCents(rate.rateCents)}</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {editId === rate.userId ? (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-emerald-400 hover:text-emerald-300"
                      onClick={() => saveEdit(rate.userId)}
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
                    onClick={() => startEdit(rate.userId, rate.rateCents)}
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
