"use client";

import { EXPENSE_LABELS, type ExpenseCategory } from "@/lib/billing";

const EXPENSE_COLORS: Record<ExpenseCategory, { bg: string; text: string }> = {
  filing_fee: { bg: "bg-blue-100", text: "text-blue-800" },
  courier: { bg: "bg-green-100", text: "text-green-800" },
  copying: { bg: "bg-zinc-100", text: "text-zinc-700" },
  expert_fee: { bg: "bg-purple-100", text: "text-purple-800" },
  travel: { bg: "bg-orange-100", text: "text-orange-800" },
  postage: { bg: "bg-yellow-100", text: "text-yellow-800" },
  service_of_process: { bg: "bg-pink-100", text: "text-pink-800" },
  other: { bg: "bg-zinc-100", text: "text-zinc-600" },
};

export function ExpenseCategoryBadge({ category }: { category: ExpenseCategory }) {
  const { bg, text } = EXPENSE_COLORS[category];
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${bg} ${text}`}
    >
      {EXPENSE_LABELS[category]}
    </span>
  );
}
