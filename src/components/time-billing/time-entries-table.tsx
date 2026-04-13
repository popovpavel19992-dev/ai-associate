"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatHours, formatCents } from "@/lib/billing";
import type { TimeEntry } from "@/server/db/schema/time-entries";
import { ActivityBadge } from "./activity-badge";
import { TimeEntryFormDialog } from "./time-entry-form-dialog";
import { Button } from "@/components/ui/button";

interface TimeEntriesTableProps {
  caseId: string;
}

export function TimeEntriesTable({ caseId }: TimeEntriesTableProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.timeEntries.list.useQuery({ caseId });
  const [editEntry, setEditEntry] = useState<TimeEntry | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);

  const deleteEntry = trpc.timeEntries.delete.useMutation({
    onSuccess: () => {
      utils.timeEntries.list.invalidate({ caseId });
      toast.success("Time entry deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleEdit(entry: TimeEntry) {
    setEditEntry(entry);
    setEditOpen(true);
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this time entry?")) return;
    deleteEntry.mutate({ id });
  }

  function formatEntryDate(d: Date | string) {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>;
  }

  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No time entries yet.
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
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Activity</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Description</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Duration</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Rate</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Amount</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-zinc-800/50 hover:bg-zinc-900/30"
              >
                <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                  {formatEntryDate(entry.entryDate)}
                </td>
                <td className="px-4 py-3">
                  <ActivityBadge type={entry.activityType} />
                </td>
                <td className="max-w-[220px] px-4 py-3 text-zinc-300">
                  <span className="line-clamp-2">{entry.description}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-300">
                  {formatHours(entry.durationMinutes)} hr
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-400">
                  {entry.isBillable ? `${formatCents(entry.rateCents)}/hr` : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-200">
                  {entry.isBillable ? formatCents(entry.amountCents) : "Non-billable"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
                      onClick={() => handleEdit(entry)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
                      onClick={() => handleDelete(entry.id)}
                      disabled={deleteEntry.isPending}
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

      <TimeEntryFormDialog
        caseId={caseId}
        entry={editEntry}
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditEntry(undefined);
        }}
      />
    </>
  );
}
