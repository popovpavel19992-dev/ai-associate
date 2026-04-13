"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EXPENSE_CATEGORIES, EXPENSE_LABELS } from "@/lib/billing";
import type { Expense } from "@/server/db/schema/expenses";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ExpenseFormDialogProps {
  caseId: string;
  expense?: Expense;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseFormDialog({
  caseId,
  expense,
  open,
  onOpenChange,
}: ExpenseFormDialogProps) {
  const utils = trpc.useUtils();
  const isEdit = !!expense;

  const [expenseDate, setExpenseDate] = useState(todayString());
  const [category, setCategory] = useState<(typeof EXPENSE_CATEGORIES)[number]>("other");
  const [description, setDescription] = useState("");
  const [amountDollars, setAmountDollars] = useState("0.00");

  useEffect(() => {
    if (open && expense) {
      setExpenseDate(
        expense.expenseDate instanceof Date
          ? expense.expenseDate.toISOString().slice(0, 10)
          : String(expense.expenseDate).slice(0, 10),
      );
      setCategory(expense.category);
      setDescription(expense.description);
      setAmountDollars((expense.amountCents / 100).toFixed(2));
    } else if (open && !expense) {
      setExpenseDate(todayString());
      setCategory("other");
      setDescription("");
      setAmountDollars("0.00");
    }
  }, [open, expense]);

  const create = trpc.expenses.create.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate({ caseId });
      toast.success("Expense added");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const update = trpc.expenses.update.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate({ caseId });
      toast.success("Expense updated");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const isPending = create.isPending || update.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(parseFloat(amountDollars) * 100);
    if (amountCents < 1) {
      toast.error("Amount must be at least $0.01");
      return;
    }

    if (isEdit && expense) {
      update.mutate({ id: expense.id, category, description, amountCents, expenseDate });
    } else {
      create.mutate({ caseId, category, description, amountCents, expenseDate });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Expense" : "Add Expense"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="expense-date">Date</Label>
            <Input
              id="expense-date"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as (typeof EXPENSE_CATEGORIES)[number])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {EXPENSE_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expense-description">Description</Label>
            <Textarea
              id="expense-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this expense"
              rows={2}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expense-amount">Amount ($)</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">$</span>
              <Input
                id="expense-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                className="w-32"
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
