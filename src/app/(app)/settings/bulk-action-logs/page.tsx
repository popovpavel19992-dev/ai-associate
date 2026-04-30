"use client";

// src/app/(app)/settings/bulk-action-logs/page.tsx
// Phase 3.15 — Owner/admin audit log of bulk operations on cases.

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

const ACTION_LABELS: Record<string, string> = {
  archive: "Archive",
  reassign_lead: "Reassign Lead",
  export_csv: "Export CSV",
  restore: "Restore",
};

const ACTION_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  archive: "destructive",
  reassign_lead: "secondary",
  export_csv: "outline",
  restore: "default",
};

export default function BulkActionLogsPage() {
  const { data: profile, isLoading: profileLoading } =
    trpc.users.getProfile.useQuery();
  const { data, isLoading } = trpc.bulkOperations.listLogs.useQuery({
    limit: 100,
  });
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  const isOwnerOrAdmin =
    profile?.role === "owner" || profile?.role === "admin";

  if (profileLoading || isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isOwnerOrAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Owner/admin access required.
      </div>
    );
  }

  const logs = data?.logs ?? [];
  const openLog = logs.find((l) => l.id === openLogId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bulk Action Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit trail of bulk operations performed on cases.
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-md border border-zinc-800 p-6 text-sm text-muted-foreground">
          No bulk actions yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Targets</th>
                <th className="px-4 py-2">Performed by</th>
                <th className="px-4 py-2">Summary</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-zinc-800 hover:bg-zinc-900/30"
                >
                  <td className="px-4 py-2 align-top text-muted-foreground">
                    {new Date(log.performedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <Badge variant={ACTION_VARIANT[log.actionType] ?? "outline"}>
                      {ACTION_LABELS[log.actionType] ?? log.actionType}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 align-top">{log.targetCount}</td>
                  <td className="px-4 py-2 align-top">
                    {log.performedByName ?? log.performedBy}
                  </td>
                  <td className="px-4 py-2 align-top text-muted-foreground">
                    {log.summary ?? ""}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => setOpenLogId(log.id)}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      View details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={openLog !== null}
        onOpenChange={(o) => !o && setOpenLogId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk action details</DialogTitle>
          </DialogHeader>
          {openLog && (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Action
                </div>
                <div className="font-medium">
                  {ACTION_LABELS[openLog.actionType] ?? openLog.actionType}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Performed at
                </div>
                <div>{new Date(openLog.performedAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="mb-1 text-xs uppercase text-muted-foreground">
                  Target cases ({openLog.targetCount})
                </div>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-zinc-800 p-2 text-xs">
                  {(openLog.targetCaseIds ?? []).map((id) => (
                    <li key={id}>
                      <Link
                        href={`/cases/${id}`}
                        className="text-blue-400 hover:underline"
                      >
                        {id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-xs uppercase text-muted-foreground">
                  Parameters
                </div>
                <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                  {JSON.stringify(openLog.parameters ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
