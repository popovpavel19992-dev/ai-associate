"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { parseUsdToCents } from "./format";

interface BaseProps {
  accountId: string;
  onClose: () => void;
  defaultClientId?: string | null;
  defaultCaseId?: string | null;
}

function ClientPicker({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const { data } = trpc.clients.list.useQuery({ status: "active", limit: 100, offset: 0 });
  const list = (data?.clients ?? []) as Array<{ id: string; displayName: string }>;
  return (
    <select
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
    >
      <option value="">{required ? "Select client *" : "(none)"}</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {c.displayName}
        </option>
      ))}
    </select>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewDepositDialog({
  accountId,
  onClose,
  defaultClientId,
  defaultCaseId,
}: BaseProps) {
  const utils = trpc.useUtils();
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [payorName, setPayorName] = useState("");
  const [description, setDescription] = useState("");
  const [checkNumber, setCheckNumber] = useState("");

  const mut = trpc.trustAccounting.transactions.recordDeposit.useMutation({
    onSuccess: async () => {
      toast.success("Deposit recorded");
      await utils.trustAccounting.transactions.list.invalidate();
      await utils.trustAccounting.balances.getAccount.invalidate();
      await utils.trustAccounting.balances.getAllClients.invalidate();
      await utils.trustAccounting.balances.getClient.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseUsdToCents(amount);
    if (!cents || cents <= 0) {
      toast.error("Amount must be a positive number");
      return;
    }
    mut.mutate({
      accountId,
      clientId: clientId || null,
      caseId: defaultCaseId ?? null,
      amountCents: cents,
      transactionDate: date,
      payorName: payorName || null,
      description: description.trim(),
      checkNumber: checkNumber || null,
    });
  }

  return (
    <Modal title="Record Deposit" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <Field label="Client (recommended for IOLTA)">
          <ClientPicker value={clientId} onChange={setClientId} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (USD) *">
            <input
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              placeholder="1000.00"
            />
          </Field>
          <Field label="Date *">
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </Field>
        </div>
        <Field label="Payor name">
          <input
            value={payorName}
            onChange={(e) => setPayorName(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <Field label="Check number">
          <input
            value={checkNumber}
            onChange={(e) => setCheckNumber(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <Field label="Description *">
          <input
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <Submit pending={mut.isPending} onCancel={onClose} label="Record deposit" />
      </form>
    </Modal>
  );
}

export function NewDisbursementDialog({
  accountId,
  onClose,
  defaultClientId,
  defaultCaseId,
}: BaseProps) {
  const utils = trpc.useUtils();
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [payeeName, setPayeeName] = useState("");
  const [description, setDescription] = useState("");
  const [checkNumber, setCheckNumber] = useState("");

  const mut = trpc.trustAccounting.transactions.recordDisbursement.useMutation({
    onSuccess: async () => {
      toast.success("Disbursement recorded");
      await utils.trustAccounting.transactions.list.invalidate();
      await utils.trustAccounting.balances.getAccount.invalidate();
      await utils.trustAccounting.balances.getAllClients.invalidate();
      await utils.trustAccounting.balances.getClient.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseUsdToCents(amount);
    if (!cents || cents <= 0) {
      toast.error("Amount must be a positive number");
      return;
    }
    if (!clientId) {
      toast.error("Client is required for disbursements");
      return;
    }
    mut.mutate({
      accountId,
      clientId,
      caseId: defaultCaseId ?? null,
      amountCents: cents,
      transactionDate: date,
      payeeName: payeeName.trim(),
      description: description.trim(),
      checkNumber: checkNumber || null,
    });
  }

  return (
    <Modal title="Record Disbursement" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <Field label="Client *">
          <ClientPicker value={clientId} onChange={setClientId} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (USD) *">
            <input
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
              placeholder="500.00"
            />
          </Field>
          <Field label="Date *">
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            />
          </Field>
        </div>
        <Field label="Payee *">
          <input
            required
            value={payeeName}
            onChange={(e) => setPayeeName(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <Field label="Check number / wire reference">
          <input
            value={checkNumber}
            onChange={(e) => setCheckNumber(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <Field label="Description *">
          <input
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <p className="text-xs text-amber-400">
          Disbursements that would drive the client&apos;s trust balance below zero
          will be blocked.
        </p>
        <Submit pending={mut.isPending} onCancel={onClose} label="Record disbursement" />
      </form>
    </Modal>
  );
}

export function VoidTransactionDialog({
  transactionId,
  onClose,
}: {
  transactionId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const mut = trpc.trustAccounting.transactions.void.useMutation({
    onSuccess: async () => {
      toast.success("Transaction voided");
      await utils.trustAccounting.transactions.list.invalidate();
      await utils.trustAccounting.balances.getAccount.invalidate();
      await utils.trustAccounting.balances.getAllClients.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return toast.error("Reason required");
    mut.mutate({ transactionId, reason: reason.trim() });
  }
  return (
    <Modal title="Void transaction" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-xs text-zinc-400">
          The original row stays in the ledger and a reversing entry is added.
          Provide a clear reason for the audit trail.
        </p>
        <Field label="Reason *">
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <Submit pending={mut.isPending} onCancel={onClose} label="Void transaction" />
      </form>
    </Modal>
  );
}

export function NewReconciliationDialog({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [periodMonth, setPeriodMonth] = useState(() => {
    const d = new Date();
    d.setUTCDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [bankBalance, setBankBalance] = useState("");

  const cents = parseUsdToCents(bankBalance);
  const previewQ = trpc.trustAccounting.reconciliation.preview.useQuery(
    {
      accountId,
      periodMonth,
      bankStatementBalanceCents: cents ?? 0,
    },
    { enabled: cents !== null && periodMonth.length === 10 },
  );

  const mut = trpc.trustAccounting.reconciliation.record.useMutation({
    onSuccess: async (out) => {
      toast.success(
        out.status === "matched" ? "Reconciliation matched" : "Reconciliation saved with discrepancy",
      );
      await utils.trustAccounting.reconciliation.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (cents === null) return toast.error("Enter a bank balance");
    mut.mutate({
      accountId,
      periodMonth,
      bankStatementBalanceCents: cents,
      notes: null,
    });
  }

  return (
    <Modal title="New Reconciliation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <Field label="Period month *">
          <input
            required
            type="date"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
          />
        </Field>
        <Field label="Bank statement balance (USD) *">
          <input
            required
            value={bankBalance}
            onChange={(e) => setBankBalance(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5"
            placeholder="0.00"
          />
        </Field>
        {previewQ.data ? (
          <div className="rounded border border-zinc-700 bg-zinc-950 p-3 text-xs">
            <p>
              Computed book balance: ${(previewQ.data.bookBalanceCents / 100).toFixed(2)}
            </p>
            <p>
              Computed client ledger sum: ${(previewQ.data.clientLedgerSumCents / 100).toFixed(2)}
            </p>
            <p className="mt-1 font-bold">
              Status: {previewQ.data.status === "matched" ? "MATCHED" : "DISCREPANCY"}
            </p>
          </div>
        ) : null}
        <Submit pending={mut.isPending} onCancel={onClose} label="Save reconciliation" />
      </form>
    </Modal>
  );
}

// ---------- shared bits ----------

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

function Submit({
  pending,
  onCancel,
  label,
}: {
  pending: boolean;
  onCancel: () => void;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        {pending ? "Saving..." : label}
      </button>
    </div>
  );
}
