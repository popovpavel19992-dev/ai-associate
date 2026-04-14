"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCents, formatHours } from "@/lib/billing";
import { Button, buttonVariants } from "@/components/ui/button";
import { InvoiceStatusPill } from "./invoice-status-pill";
import { Download, Pencil, Send, Trash2, CheckCircle, XCircle } from "lucide-react";

interface InvoiceDetailProps {
  invoiceId: string;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM d, yyyy");
}

export function InvoiceDetail({ invoiceId }: InvoiceDetailProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const { data, isLoading } = trpc.invoices.getById.useQuery({ id: invoiceId });

  const pdfQuery = trpc.invoices.generatePdf.useQuery(
    { id: invoiceId },
    { enabled: false },
  );

  const sendMutation = trpc.invoices.send.useMutation({
    onSuccess: () => { utils.invoices.getById.invalidate({ id: invoiceId }); toast.success("Invoice sent"); },
    onError: (err) => toast.error(err.message),
  });
  const markPaidMutation = trpc.invoices.markPaid.useMutation({
    onSuccess: () => { utils.invoices.getById.invalidate({ id: invoiceId }); toast.success("Marked as paid"); },
    onError: (err) => toast.error(err.message),
  });
  const voidMutation = trpc.invoices.void.useMutation({
    onSuccess: () => { utils.invoices.getById.invalidate({ id: invoiceId }); toast.success("Invoice voided"); },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = trpc.invoices.delete.useMutation({
    onSuccess: () => { toast.success("Invoice deleted"); router.push("/invoices"); },
    onError: (err) => toast.error(err.message),
  });

  async function handleDownloadPdf() {
    const result = await pdfQuery.refetch();
    if (!result.data?.pdf) { toast.error("Failed to generate PDF"); return; }
    const blob = new Blob([Buffer.from(result.data.pdf, "base64")], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data?.invoice.invoiceNumber ?? "invoice"}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-zinc-500">Loading…</p>;
  }

  if (!data) {
    return <p className="py-10 text-center text-sm text-zinc-500">Invoice not found.</p>;
  }

  const { invoice, lineItems, client } = data;
  const status = invoice.status;

  // Group line items by case
  const byCase: Record<string, { caseName: string; items: typeof lineItems }> = {};
  for (const item of lineItems) {
    if (!byCase[item.caseId]) {
      byCase[item.caseId] = { caseName: item.caseName, items: [] };
    }
    byCase[item.caseId]!.items.push(item);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold text-zinc-50">
              {invoice.invoiceNumber}
            </h1>
            <InvoiceStatusPill status={invoice.status} dueDate={invoice.dueDate} />
          </div>
          {client && (
            <Link
              href={`/clients/${client.id}`}
              className="text-sm text-zinc-400 hover:text-zinc-200"
            >
              {client.displayName}
            </Link>
          )}
          <div className="flex gap-4 text-xs text-zinc-500">
            <span>Issued: {fmtDate(invoice.issuedDate)}</span>
            <span>Due: {fmtDate(invoice.dueDate)}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {status === "draft" && (
            <>
              <Link
                href={`/invoices/${invoiceId}/edit`}
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Link>
              <Button
                size="sm"
                onClick={() => sendMutation.mutate({ id: invoiceId })}
                disabled={sendMutation.isPending}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Send
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:text-red-300"
                onClick={() => {
                  if (!confirm("Delete this invoice?")) return;
                  deleteMutation.mutate({ id: invoiceId });
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete
              </Button>
            </>
          )}
          {status === "sent" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => markPaidMutation.mutate({ id: invoiceId })}
                disabled={markPaidMutation.isPending}
              >
                <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                Mark Paid
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-400 hover:text-zinc-200"
                onClick={() => {
                  if (!confirm("Void this invoice?")) return;
                  voidMutation.mutate({ id: invoiceId });
                }}
                disabled={voidMutation.isPending}
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                Void
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadPdf}
                disabled={pdfQuery.isFetching}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                PDF
              </Button>
            </>
          )}
          {status === "paid" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={pdfQuery.isFetching}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              PDF
            </Button>
          )}
        </div>
      </div>

      {/* Line items grouped by case */}
      <div className="space-y-4">
        {Object.entries(byCase).map(([caseId, { caseName, items }]) => (
          <div key={caseId} className="rounded-lg border border-zinc-800">
            <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-2.5">
              <p className="text-sm font-medium text-zinc-300">{caseName}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800/50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500">Description</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500">Qty</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500">Rate</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-800/30">
                    <td className="px-4 py-2.5 text-zinc-300">{item.description}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-zinc-400">
                      {item.type === "time" ? `${item.quantity} hr` : "1"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-zinc-400">
                      {formatCents(item.unitPriceCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-zinc-200">
                      {formatCents(item.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="ml-auto w-full max-w-xs rounded-lg border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50">
        <div className="flex justify-between px-4 py-2.5 text-sm text-zinc-400">
          <span>Subtotal</span>
          <span>{formatCents(invoice.subtotalCents)}</span>
        </div>
        <div className="flex justify-between px-4 py-2.5 text-sm text-zinc-400">
          <span>Tax</span>
          <span>{formatCents(invoice.taxCents)}</span>
        </div>
        <div className="flex justify-between px-4 py-2.5 text-base font-semibold text-zinc-50">
          <span>Total</span>
          <span>{formatCents(invoice.totalCents)}</span>
        </div>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <p className="text-xs font-medium text-zinc-500 mb-1">Notes</p>
          <p className="text-sm text-zinc-300 whitespace-pre-line">{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
