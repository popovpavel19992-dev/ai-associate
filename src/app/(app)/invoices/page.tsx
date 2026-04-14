"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/billing";
import { Button, buttonVariants } from "@/components/ui/button";
import { SummaryCards } from "@/components/time-billing/summary-cards";
import { InvoiceFilters } from "@/components/time-billing/invoice-filters";
import { InvoiceTable } from "@/components/time-billing/invoice-table";
import type { InvoiceStatus } from "@/lib/billing";

export default function InvoicesPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  // For the "overdue" filter, we query "sent" from backend and filter client-side
  const queryStatus = statusFilter === "overdue" ? "sent" : (statusFilter as InvoiceStatus | undefined);

  const { data, isLoading } = trpc.invoices.list.useQuery({
    status: queryStatus,
    limit: 100,
  });

  const { data: summaryData } = trpc.invoices.getSummary.useQuery();

  const summary = summaryData?.summary;

  const summaryCards = [
    {
      label: "Outstanding",
      value: summary ? formatCents(summary.sent.totalCents) : "—",
      subtitle: summary ? `${summary.sent.count} invoice${summary.sent.count !== 1 ? "s" : ""}` : undefined,
    },
    {
      label: "Overdue",
      value: summary ? formatCents(summary.overdue.totalCents) : "—",
      subtitle: summary ? `${summary.overdue.count} invoice${summary.overdue.count !== 1 ? "s" : ""}` : undefined,
    },
    {
      label: "Paid This Month",
      value: summary ? formatCents(summary.paid.totalCents) : "—",
      subtitle: summary ? `${summary.paid.count} invoice${summary.paid.count !== 1 ? "s" : ""}` : undefined,
    },
    {
      label: "Draft",
      value: summary ? formatCents(summary.draft.totalCents) : "—",
      subtitle: summary ? `${summary.draft.count} invoice${summary.draft.count !== 1 ? "s" : ""}` : undefined,
    },
  ];

  // For overdue, client-side filter
  let invoices = data?.invoices ?? [];
  if (statusFilter === "overdue") {
    const now = new Date();
    invoices = invoices.filter(
      (inv) => inv.status === "sent" && inv.dueDate != null && new Date(inv.dueDate) < now,
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-50">Invoices</h1>
        <Link
          href="/invoices/new"
          className={buttonVariants({ size: "sm" })}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New Invoice
        </Link>
      </div>

      <SummaryCards cards={summaryCards} />

      <InvoiceFilters
        status={statusFilter}
        onStatusChange={setStatusFilter}
      />

      <InvoiceTable invoices={invoices} isLoading={isLoading} />
    </div>
  );
}
