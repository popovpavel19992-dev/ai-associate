"use client";

import { trpc } from "@/lib/trpc";
import { formatCents, formatHours } from "@/lib/billing";

interface InvoiceItemSelectorProps {
  clientId: string;
  selectedItems: Set<string>;
  onToggle: (id: string, type: "time" | "expense") => void;
}

export function InvoiceItemSelector({ clientId, selectedItems, onToggle }: InvoiceItemSelectorProps) {
  const { data: timeData, isLoading: timeLoading } = trpc.timeEntries.listUninvoiced.useQuery({ clientId });
  const { data: expenseData, isLoading: expLoading } = trpc.expenses.listUninvoiced.useQuery({ clientId });

  if (timeLoading || expLoading) {
    return <p className="py-6 text-center text-sm text-zinc-500">Loading items…</p>;
  }

  const timeByCaseEntries = Object.entries(timeData?.byCase ?? {});
  const expByCaseEntries = Object.entries(expenseData?.byCase ?? {});

  if (timeByCaseEntries.length === 0 && expByCaseEntries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        No uninvoiced billable items for this client.
      </p>
    );
  }

  // Merge by caseId
  const caseMap: Record<string, { caseName: string; caseId: string }> = {};
  for (const [caseId, { caseName }] of timeByCaseEntries) {
    caseMap[caseId] = { caseName, caseId };
  }
  for (const [caseId, { caseName }] of expByCaseEntries) {
    if (!caseMap[caseId]) caseMap[caseId] = { caseName, caseId };
  }

  return (
    <div className="space-y-4">
      {Object.values(caseMap).map(({ caseName, caseId }) => {
        const entries = timeData?.byCase[caseId]?.entries ?? [];
        const expenses = expenseData?.byCase[caseId]?.expenses ?? [];

        return (
          <div key={caseId} className="rounded-lg border border-zinc-800">
            <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-2">
              <p className="text-sm font-medium text-zinc-300">{caseName}</p>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {entries.map((entry) => (
                <label
                  key={entry.id}
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-zinc-900/30"
                >
                  <input
                    type="checkbox"
                    checked={selectedItems.has(entry.id)}
                    onChange={() => onToggle(entry.id, "time")}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-zinc-50"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{entry.description}</p>
                    <p className="text-xs text-zinc-500">
                      {formatHours(entry.durationMinutes)} hr · {formatCents(entry.rateCents)}/hr
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-zinc-300">
                    {formatCents(entry.amountCents)}
                  </span>
                </label>
              ))}
              {expenses.map((expense) => (
                <label
                  key={expense.id}
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-zinc-900/30"
                >
                  <input
                    type="checkbox"
                    checked={selectedItems.has(expense.id)}
                    onChange={() => onToggle(expense.id, "expense")}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-zinc-50"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{expense.description}</p>
                    <p className="text-xs text-zinc-500">Expense</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-zinc-300">
                    {formatCents(expense.amountCents)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
