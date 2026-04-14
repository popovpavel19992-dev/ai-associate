"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/billing";
import type { Expense } from "@/server/db/schema/expenses";
import { ExpenseCategoryBadge } from "./expense-category-badge";
import { ExpenseFormDialog } from "./expense-form-dialog";
import { Button } from "@/components/ui/button";

interface ExpensesTableProps {
  caseId: string;
}

export function ExpensesTable({ caseId }: ExpensesTableProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.expenses.list.useQuery({ caseId });
  const [editExpense, setEditExpense] = useState<Expense | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);

  const deleteExpense = trpc.expenses.delete.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate({ caseId });
      toast.success("Expense deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleEdit(expense: Expense) {
    setEditExpense(expense);
    setEditOpen(true);
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this expense?")) return;
    deleteExpense.mutate({ id });
  }

  function formatExpenseDate(d: Date | string) {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>;
  }

  const expenseList = data?.expenses ?? [];

  if (expenseList.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No expenses yet.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Category</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Description</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Amount</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenseList.map((exp) => (
              <tr
                key={exp.id}
                className="border-b border-zinc-800/50 hover:bg-zinc-900/30"
              >
                <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                  {formatExpenseDate(exp.expenseDate)}
                </td>
                <td className="px-4 py-3">
                  <ExpenseCategoryBadge category={exp.category} />
                </td>
                <td className="max-w-[240px] px-4 py-3 text-zinc-300">
                  <span className="line-clamp-2">{exp.description}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-200">
                  {formatCents(exp.amountCents)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
                      onClick={() => handleEdit(exp)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
                      onClick={() => handleDelete(exp.id)}
                      disabled={deleteExpense.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ExpenseFormDialog
        caseId={caseId}
        expense={editExpense}
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditExpense(undefined);
        }}
      />
    </>
  );
}
