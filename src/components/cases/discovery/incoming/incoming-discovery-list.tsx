"use client";
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { AddIncomingDiscoveryDialog } from "./add-incoming-discovery-dialog";
import { IncomingDiscoveryDetail } from "./incoming-discovery-detail";

interface Props {
  caseId: string;
}

export function IncomingDiscoveryList({ caseId }: Props) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data, isLoading } = trpc.discoveryResponseDrafter.listIncoming.useQuery({
    caseId,
  });

  if (activeId) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setActiveId(null)}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ← Back to list
        </button>
        <IncomingDiscoveryDetail requestId={activeId} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">
          Incoming discovery
        </h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-3" /> Add Incoming
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-zinc-500" />
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          No incoming discovery yet. Click &quot;Add Incoming&quot; to paste or
          upload requests received from opposing counsel.
        </div>
      ) : (
        <ul className="space-y-2">
          {data!.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setActiveId(r.id)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-100">
                    {r.requestType.toUpperCase()} — Set {r.setNumber}
                  </span>
                  <span className="text-xs text-zinc-500">{r.status}</span>
                </div>
                <p className="text-xs text-zinc-500">
                  From {r.servingParty}
                  {r.dueAt &&
                    ` · due ${new Date(r.dueAt).toLocaleDateString()}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <AddIncomingDiscoveryDialog
          caseId={caseId}
          onClose={() => setOpen(false)}
          onCreated={(id) => {
            setOpen(false);
            setActiveId(id);
          }}
        />
      )}
    </div>
  );
}
