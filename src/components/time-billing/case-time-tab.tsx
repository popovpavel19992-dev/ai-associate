"use client";

import { useState } from "react";
import { Plus, Play, DollarSign } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatCents, formatHours } from "@/lib/billing";
import { SummaryCards } from "./summary-cards";
import { TimerBanner } from "./timer-banner";
import { TimerStartDialog } from "./timer-start-dialog";
import { TimeEntryFormDialog } from "./time-entry-form-dialog";
import { TimeEntriesTable } from "./time-entries-table";
import { ExpensesTable } from "./expenses-table";
import { ExpenseFormDialog } from "./expense-form-dialog";
import { RateOverrideDialog } from "./rate-override-dialog";
import { SuggestionsInbox } from "./suggestions-inbox";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface CaseTimeTabProps {
  caseId: string;
}

export function CaseTimeTab({ caseId }: CaseTimeTabProps) {
  const [timerDialogOpen, setTimerDialogOpen] = useState(false);
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [rateOverrideOpen, setRateOverrideOpen] = useState(false);

  const { data: entriesData } = trpc.timeEntries.list.useQuery({ caseId, limit: 200 });
  const { data: expensesData } = trpc.expenses.list.useQuery({ caseId, limit: 200 });

  const entries = entriesData?.entries ?? [];
  const expenseList = expensesData?.expenses ?? [];

  const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
  const billableAmount = entries
    .filter((e) => e.isBillable)
    .reduce((sum, e) => sum + e.amountCents, 0);
  const totalExpenses = expenseList.reduce((sum, e) => sum + e.amountCents, 0);
  const uninvoiced = billableAmount + totalExpenses;

  const summaryCards = [
    { label: "Total Hours", value: `${formatHours(totalMinutes)} hr` },
    { label: "Billable Amount", value: formatCents(billableAmount) },
    { label: "Expenses", value: formatCents(totalExpenses) },
    { label: "Uninvoiced", value: formatCents(uninvoiced), subtitle: "Billable + expenses" },
  ];

  return (
    <div className="space-y-5">
      <SummaryCards cards={summaryCards} />

      <TimerBanner caseId={caseId} />

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTimerDialogOpen(true)}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          Start Timer
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddEntryOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Entry
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRateOverrideOpen(true)}
        >
          <DollarSign className="mr-1.5 h-3.5 w-3.5" />
          Set Rates
        </Button>
      </div>

      {/* Auto-billable suggestions for this case */}
      <SuggestionsInbox caseId={caseId} />

      <Separator className="border-zinc-800" />

      {/* Time Entries */}
      <TimeEntriesTable caseId={caseId} />

      <Separator className="border-zinc-800" />

      {/* Expenses section */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Expenses</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddExpenseOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Expense
        </Button>
      </div>

      <ExpensesTable caseId={caseId} />

      {/* Dialogs */}
      <TimerStartDialog
        caseId={caseId}
        open={timerDialogOpen}
        onOpenChange={setTimerDialogOpen}
      />
      <TimeEntryFormDialog
        caseId={caseId}
        open={addEntryOpen}
        onOpenChange={setAddEntryOpen}
      />
      <ExpenseFormDialog
        caseId={caseId}
        open={addExpenseOpen}
        onOpenChange={setAddExpenseOpen}
      />
      <RateOverrideDialog
        caseId={caseId}
        open={rateOverrideOpen}
        onOpenChange={setRateOverrideOpen}
      />
    </div>
  );
}
