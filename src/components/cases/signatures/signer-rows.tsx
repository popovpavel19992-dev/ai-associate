// src/components/cases/signatures/signer-rows.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

export const SIGNER_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#db2777",
] as const;

export type SignerSource = "contact" | "member" | "manual";

export interface SignerRow {
  /** Stable row id for React keys */
  rowId: string;
  source: SignerSource;
  /** When source=contact */
  clientContactId?: string;
  /** When source=member */
  userId?: string;
  /** Name + email — populated for all sources. For contact/member filled from picker. */
  name: string;
  email: string;
  /** Sequential order slot — meaningful only when parent signingOrder === 'sequential'. */
  order: number;
}

export function colorForIndex(index: number): string {
  return SIGNER_COLORS[index % SIGNER_COLORS.length];
}

export function isRowValid(r: SignerRow): boolean {
  if (r.source === "contact") return !!r.clientContactId && !!r.email;
  if (r.source === "member") return !!r.userId && !!r.email;
  // manual
  return r.email.trim().length > 0 && /.+@.+\..+/.test(r.email) && r.name.trim().length > 0;
}

interface SignerRowsProps {
  caseId: string;
  rows: SignerRow[];
  onChange: (rows: SignerRow[]) => void;
  signingOrder: "parallel" | "sequential";
  onSigningOrderChange: (v: "parallel" | "sequential") => void;
}

export function SignerRows({
  caseId,
  rows,
  onChange,
  signingOrder,
  onSigningOrderChange,
}: SignerRowsProps) {
  const contactsQuery = trpc.clientContacts.listForCase.useQuery({ caseId });
  const membersQuery = trpc.caseMembers.list.useQuery({ caseId });

  const contacts = contactsQuery.data?.contacts ?? [];
  const members = membersQuery.data ?? [];

  const updateRow = (rowId: string, patch: Partial<SignerRow>) => {
    onChange(rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowId: string) => {
    onChange(
      rows
        .filter((r) => r.rowId !== rowId)
        .map((r, i) => ({ ...r, order: i })),
    );
  };

  const addRow = () => {
    if (rows.length >= 5) return;
    onChange([
      ...rows,
      {
        rowId: crypto.randomUUID(),
        source: "contact",
        name: "",
        email: "",
        order: rows.length,
      },
    ]);
  };

  const moveRow = (rowId: string, dir: -1 | 1) => {
    const idx = rows.findIndex((r) => r.rowId === rowId);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= rows.length) return;
    const next = [...rows];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    onChange(next.map((r, i) => ({ ...r, order: i })));
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Signing order</Label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={signingOrder === "parallel"}
              onChange={() => onSigningOrderChange("parallel")}
            />
            Parallel (anyone, any time)
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={signingOrder === "sequential"}
              onChange={() => onSigningOrderChange("sequential")}
            />
            Sequential
          </label>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div
            key={row.rowId}
            className="rounded-md border bg-background p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: colorForIndex(idx) }}
              />
              <span className="text-xs font-medium text-muted-foreground">
                Signer {idx + 1}
              </span>
              {signingOrder === "sequential" && (
                <div className="flex items-center gap-1 ml-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={idx === 0}
                    onClick={() => moveRow(row.rowId, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={idx === rows.length - 1}
                    onClick={() => moveRow(row.rowId, 1)}
                  >
                    ↓
                  </Button>
                </div>
              )}
              {rows.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => removeRow(row.rowId)}
                  aria-label="Remove signer"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={row.source === "contact"}
                  onChange={() =>
                    updateRow(row.rowId, {
                      source: "contact",
                      clientContactId: undefined,
                      userId: undefined,
                      name: "",
                      email: "",
                    })
                  }
                />
                Client contact
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={row.source === "member"}
                  onChange={() =>
                    updateRow(row.rowId, {
                      source: "member",
                      clientContactId: undefined,
                      userId: undefined,
                      name: "",
                      email: "",
                    })
                  }
                />
                Team member
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={row.source === "manual"}
                  onChange={() =>
                    updateRow(row.rowId, {
                      source: "manual",
                      clientContactId: undefined,
                      userId: undefined,
                      name: "",
                      email: "",
                    })
                  }
                />
                Other
              </label>
            </div>

            {row.source === "contact" && (
              <select
                className="w-full rounded border p-2 text-sm"
                value={row.clientContactId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const c = contacts.find(
                    (x: { id: string }) => x.id === id,
                  ) as { id: string; name: string; email: string | null } | undefined;
                  updateRow(row.rowId, {
                    clientContactId: id || undefined,
                    name: c?.name ?? "",
                    email: c?.email ?? "",
                  });
                }}
              >
                <option value="">Pick contact…</option>
                {contacts
                  .filter(
                    (c: { email: string | null }) => !!c.email,
                  )
                  .map(
                    (c: { id: string; name: string; email: string | null }) => (
                      <option key={c.id} value={c.id}>
                        {c.name ? `${c.name} — ` : ""}
                        {c.email}
                      </option>
                    ),
                  )}
              </select>
            )}

            {row.source === "member" && (
              <select
                className="w-full rounded border p-2 text-sm"
                value={row.userId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const m = members.find(
                    (x: { userId: string }) => x.userId === id,
                  ) as
                    | { userId: string; userName: string | null; userEmail: string }
                    | undefined;
                  updateRow(row.rowId, {
                    userId: id || undefined,
                    name: m?.userName ?? "",
                    email: m?.userEmail ?? "",
                  });
                }}
              >
                <option value="">Pick team member…</option>
                {members.map(
                  (m: {
                    userId: string;
                    userName: string | null;
                    userEmail: string;
                  }) => (
                    <option key={m.userId} value={m.userId}>
                      {m.userName ? `${m.userName} — ` : ""}
                      {m.userEmail}
                    </option>
                  ),
                )}
              </select>
            )}

            {row.source === "manual" && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Full name"
                  value={row.name}
                  onChange={(e) =>
                    updateRow(row.rowId, { name: e.target.value })
                  }
                />
                <Input
                  placeholder="email@example.com"
                  type="email"
                  value={row.email}
                  onChange={(e) =>
                    updateRow(row.rowId, { email: e.target.value })
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={rows.length >= 5}
      >
        + Add signer ({rows.length}/5)
      </Button>
    </div>
  );
}
