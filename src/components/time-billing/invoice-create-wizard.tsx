"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCents, PAYMENT_TERMS } from "@/lib/billing";
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
import { InvoiceItemSelector } from "./invoice-item-selector";

interface InvoiceCreateWizardProps {
  invoiceId?: string;
}

type Step = 1 | 2 | 3;

interface SelectedItem {
  id: string;
  type: "time" | "expense";
  caseId: string;
  amountCents: number;
}

export function InvoiceCreateWizard({ invoiceId }: InvoiceCreateWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1 — client selection
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState("");

  // Step 2 — item selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [itemMeta, setItemMeta] = useState<Map<string, { type: "time" | "expense"; caseId: string; amountCents: number }>>(new Map());

  // Step 3 — review
  const [paymentTerms, setPaymentTerms] = useState<string>("");
  const [taxDollars, setTaxDollars] = useState("0.00");
  const [notes, setNotes] = useState("");

  const { data: searchData } = trpc.clients.searchForPicker.useQuery(
    { q: clientSearch },
    { enabled: clientSearch.trim().length >= 1 },
  );

  const { data: timeData } = trpc.timeEntries.listUninvoiced.useQuery(
    { clientId: selectedClientId! },
    { enabled: !!selectedClientId },
  );
  const { data: expenseData } = trpc.expenses.listUninvoiced.useQuery(
    { clientId: selectedClientId! },
    { enabled: !!selectedClientId },
  );

  const createMutation = trpc.invoices.create.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const updateMutation = trpc.invoices.update.useMutation({
    onError: (err) => toast.error(err.message),
  });

  function handleToggleItem(id: string, type: "time" | "expense") {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

    // Store metadata for selected items
    if (!itemMeta.has(id)) {
      // Find caseId and amount from loaded data
      let caseId = "";
      let amountCents = 0;
      if (type === "time" && timeData) {
        for (const [cId, group] of Object.entries(timeData.byCase)) {
          const entry = group.entries.find((e) => e.id === id);
          if (entry) { caseId = cId; amountCents = entry.amountCents; break; }
        }
      } else if (type === "expense" && expenseData) {
        for (const [cId, group] of Object.entries(expenseData.byCase)) {
          const exp = group.expenses.find((e) => e.id === id);
          if (exp) { caseId = cId; amountCents = exp.amountCents; break; }
        }
      }
      setItemMeta((prev) => new Map(prev).set(id, { type, caseId, amountCents }));
    }
  }

  const selectedTotal = Array.from(selectedItemIds).reduce((sum, id) => {
    return sum + (itemMeta.get(id)?.amountCents ?? 0);
  }, 0);

  const taxCents = Math.round(parseFloat(taxDollars || "0") * 100);
  const totalCents = selectedTotal + taxCents;

  async function handleSave(send: boolean) {
    if (!selectedClientId) return;

    const lineItems = Array.from(selectedItemIds)
      .map((id) => {
        const meta = itemMeta.get(id);
        if (!meta || !meta.caseId) return null;
        return { type: meta.type, sourceId: id, caseId: meta.caseId };
      })
      .filter((x): x is { type: "time" | "expense"; sourceId: string; caseId: string } => x !== null);

    if (lineItems.length === 0) {
      toast.error("Select at least one item");
      return;
    }

    if (invoiceId) {
      // Edit mode — only update notes/terms/tax
      await updateMutation.mutateAsync({
        id: invoiceId,
        paymentTerms: paymentTerms ? (paymentTerms as typeof PAYMENT_TERMS[number]) : undefined,
        taxCents,
        notes: notes || undefined,
      });
      toast.success("Invoice updated");
      router.push(`/invoices/${invoiceId}`);
      return;
    }

    const result = await createMutation.mutateAsync({
      clientId: selectedClientId,
      lineItems,
      paymentTerms: paymentTerms ? (paymentTerms as typeof PAYMENT_TERMS[number]) : undefined,
      taxCents,
      notes: notes || undefined,
    });

    toast.success("Invoice created");
    router.push(`/invoices/${result.invoice.id}`);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as Step[]).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                step === s
                  ? "bg-zinc-50 text-zinc-900"
                  : step > s
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {s}
            </div>
            {s < 3 && <div className="h-px w-8 bg-zinc-800" />}
          </div>
        ))}
        <span className="ml-3 text-sm text-zinc-400">
          {step === 1 ? "Select Client" : step === 2 ? "Select Items" : "Review"}
        </span>
      </div>

      {/* Step 1 — Select Client */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-50">Select Client</h2>
          <div className="space-y-2">
            <Label className="text-zinc-300">Search clients</Label>
            <Input
              placeholder="Type to search…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
          {searchData?.clients && searchData.clients.length > 0 && (
            <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
              {searchData.clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedClientId(c.id);
                    setSelectedClientName(c.displayName);
                    setClientSearch(c.displayName);
                    setStep(2);
                  }}
                  className="w-full px-4 py-3 text-left text-sm text-zinc-200 hover:bg-zinc-800/50 transition-colors"
                >
                  {c.displayName}
                  <span className="ml-2 text-xs text-zinc-500 capitalize">{c.clientType}</span>
                </button>
              ))}
            </div>
          )}
          {selectedClientId && (
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>Next: Select Items</Button>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Select Items */}
      {step === 2 && selectedClientId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-50">Select Items</h2>
            <p className="text-sm text-zinc-400">
              Client: <span className="text-zinc-200">{selectedClientName}</span>
            </p>
          </div>

          <InvoiceItemSelector
            clientId={selectedClientId}
            selectedItems={selectedItemIds}
            onToggle={handleToggleItem}
          />

          {selectedItemIds.size > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm">
              <span className="text-zinc-400">{selectedItemIds.size} item{selectedItemIds.size !== 1 ? "s" : ""} selected</span>
              <span className="ml-2 font-semibold text-zinc-200">· {formatCents(selectedTotal)}</span>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)} disabled={selectedItemIds.size === 0}>
              Next: Review
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — Review */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-50">Review & Finalize</h2>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-zinc-300">Payment Terms</Label>
              <Select value={paymentTerms} onValueChange={(v) => setPaymentTerms(v ?? "")}>
                <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-200">
                  <SelectValue placeholder="Select terms…" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERMS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Tax ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={taxDollars}
                onChange={(e) => setTaxDollars(e.target.value)}
                className="bg-zinc-900 border-zinc-800 text-zinc-200"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes…"
                rows={3}
                className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50">
            <div className="flex justify-between px-4 py-2.5 text-sm text-zinc-400">
              <span>Subtotal</span>
              <span>{formatCents(selectedTotal)}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5 text-sm text-zinc-400">
              <span>Tax</span>
              <span>{formatCents(taxCents)}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5 text-base font-semibold text-zinc-50">
              <span>Total</span>
              <span>{formatCents(totalCents)}</span>
            </div>
          </div>

          <div className="flex justify-between gap-3">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleSave(false)}
                disabled={isPending}
              >
                Save Draft
              </Button>
              <Button onClick={() => handleSave(true)} disabled={isPending}>
                {isPending ? "Saving…" : "Save & Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
