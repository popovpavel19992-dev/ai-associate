"use client";

import Link from "next/link";
import { format } from "date-fns";
import { formatCents, formatInvoiceNumber } from "@/lib/billing";
import type { InvoiceStatus } from "@/lib/billing";
import { InvoiceStatusPill } from "./invoice-status-pill";

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedDate?: Date | string | null;
  dueDate?: Date | string | null;
  totalCents: number;
  clientDisplayName: string;
}

interface InvoiceTableProps {
  invoices: InvoiceRow[];
  isLoading?: boolean;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM d, yyyy");
}

export function InvoiceTable({ invoices, isLoading }: InvoiceTableProps) {
  if (isLoading) {
    return <p className="py-10 text-center text-sm text-zinc-500">Loading…</p>;
  }

  if (invoices.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500">No invoices found.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Invoice #</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Client</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Date</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Due</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Status</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr
              key={inv.id}
              className="border-b border-zinc-800/50 hover:bg-zinc-900/30"
            >
              <td className="whitespace-nowrap px-4 py-3">
                <Link
                  href={`/invoices/${inv.id}`}
                  className="font-mono text-zinc-200 hover:text-zinc-50 hover:underline"
                >
                  {inv.invoiceNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-300">{inv.clientDisplayName}</td>
              <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                {fmtDate(inv.issuedDate)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                {fmtDate(inv.dueDate)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <InvoiceStatusPill status={inv.status} dueDate={inv.dueDate} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-200">
                {formatCents(inv.totalCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
