// src/app/(app)/cases/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BulkActionToolbar } from "@/components/cases/bulk-action-toolbar";
import { ReassignLeadModal } from "@/components/cases/reassign-lead-modal";

function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CasesPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.cases.list.useQuery();
  const { data: profile } = trpc.users.getProfile.useQuery();
  const { data: unreadData } = trpc.caseMessages.unreadByCase.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const unreadSet = new Set((unreadData?.byCase ?? []).map((u) => u.caseId));

  const isOwnerOrAdmin = profile?.role === "owner" || profile?.role === "admin";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [busyAction, setBusyAction] =
    useState<"archive" | "reassign" | "export" | null>(null);

  const allIds = useMemo(() => (data ?? []).map((c) => c.id), [data]);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;

  const archive = trpc.bulkOperations.archive.useMutation({
    onMutate: () => setBusyAction("archive"),
    onSettled: () => setBusyAction(null),
    onSuccess: ({ archived }) => {
      toast.success(`Archived ${archived} case(s).`);
      setSelected(new Set());
      utils.cases.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const reassign = trpc.bulkOperations.reassignLead.useMutation({
    onMutate: () => setBusyAction("reassign"),
    onSettled: () => setBusyAction(null),
    onSuccess: ({ reassigned }) => {
      toast.success(`Reassigned lead on ${reassigned} case(s).`);
      setReassignOpen(false);
      setSelected(new Set());
      utils.cases.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const exportCsv = trpc.bulkOperations.exportCsv.useMutation({
    onMutate: () => setBusyAction("export"),
    onSettled: () => setBusyAction(null),
    onSuccess: ({ csvText }) => {
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`cases-export-${date}.csv`, csvText);
      toast.success(`Exported ${selectedIds.length} case(s).`);
      setSelected(new Set());
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const handleArchive = () => {
    if (selectedIds.length === 0) return;
    if (
      !confirm(
        `Archive ${selectedIds.length} cases? They will be auto-deleted in 30 days unless restored.`,
      )
    ) {
      return;
    }
    archive.mutate({ caseIds: selectedIds });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Cases</h1>

      {isOwnerOrAdmin && selectedIds.length > 0 && (
        <BulkActionToolbar
          count={selectedIds.length}
          onClear={() => setSelected(new Set())}
          onArchive={handleArchive}
          onReassign={() => setReassignOpen(true)}
          onExport={() => exportCsv.mutate({ caseIds: selectedIds })}
          busyAction={busyAction}
        />
      )}

      {isOwnerOrAdmin && allIds.length > 0 && (
        <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Select all cases"
          />
          Select all ({allIds.length})
        </label>
      )}

      <ul className="space-y-2">
        {(data ?? []).map((c) => {
          const isSelected = selected.has(c.id);
          return (
            <li key={c.id} className="flex items-stretch gap-2">
              {isOwnerOrAdmin && (
                <label className="flex items-center pl-1 pr-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(c.id)}
                    aria-label={`Select case ${c.name}`}
                  />
                </label>
              )}
              <Link
                href={`/cases/${c.id}`}
                className={`relative block flex-1 rounded-md border border-zinc-800 p-3 hover:bg-zinc-900 ${
                  isSelected ? "ring-1 ring-blue-500" : ""
                }`}
              >
                <div className="font-medium">{c.name}</div>
                {unreadSet.has(c.id) && (
                  <span
                    className="absolute right-2 top-2 size-2 rounded-full bg-red-500"
                    aria-label="Unread messages"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <ReassignLeadModal
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        count={selectedIds.length}
        pending={reassign.isPending}
        onConfirm={(newLeadUserId) =>
          reassign.mutate({ caseIds: selectedIds, newLeadUserId })
        }
      />
    </div>
  );
}
