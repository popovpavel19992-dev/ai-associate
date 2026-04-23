// src/components/cases/deadlines/deadlines-tab.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";
import { TriggerEventsList, type TriggerEventListItem } from "./trigger-events-list";
import { DeadlineRow, type DeadlineRowData } from "./deadline-row";
import { AddTriggerEventModal } from "./add-trigger-event-modal";
import { AddCustomDeadlineModal } from "./add-custom-deadline-modal";
import { EditDeadlineModal } from "./edit-deadline-modal";

export function DeadlinesTab({ caseId }: { caseId: string }) {
  const utils = trpc.useUtils();
  const { data } = trpc.deadlines.listForCase.useQuery({ caseId });
  const [selectedTriggerId, setSelectedTriggerId] = React.useState<string | null>(null);
  const [addTriggerOpen, setAddTriggerOpen] = React.useState(false);
  const [addCustomOpen, setAddCustomOpen] = React.useState(false);
  const [editDeadline, setEditDeadline] = React.useState<DeadlineRowData | null>(null);

  const regenerate = trpc.deadlines.regenerateFromTrigger.useMutation({
    onSuccess: async (res) => {
      toast.success(`Regenerated ${res.recomputed} deadlines`);
      await utils.deadlines.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  const triggers = data?.triggers ?? [];
  const deadlines = data?.deadlines ?? [];

  const deadlineCountByTrigger = new Map<string, number>();
  for (const d of deadlines) {
    if ((d as any).triggerEventId) {
      deadlineCountByTrigger.set((d as any).triggerEventId, (deadlineCountByTrigger.get((d as any).triggerEventId) ?? 0) + 1);
    }
  }

  const triggerItems: TriggerEventListItem[] = triggers.map((t: any) => ({
    id: t.id,
    triggerEvent: t.triggerEvent,
    eventDate: t.eventDate,
    deadlineCount: deadlineCountByTrigger.get(t.id) ?? 0,
  }));

  const shown = selectedTriggerId
    ? deadlines.filter((d: any) => d.triggerEventId === selectedTriggerId)
    : deadlines.filter((d: any) => d.source === "manual");

  const sectionTitle = selectedTriggerId
    ? `Deadlines (${shown.length})`
    : `Custom deadlines (${shown.length})`;

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-72 border-r">
        <TriggerEventsList items={triggerItems} selectedId={selectedTriggerId} onSelect={setSelectedTriggerId} onAdd={() => setAddTriggerOpen(true)} />
      </aside>
      <section className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{sectionTitle}</h3>
          <div className="flex gap-2">
            {selectedTriggerId && (
              <Button size="sm" variant="outline" onClick={() => {
                if (confirm("Regenerate all deadlines from this trigger? Manual overrides will be cleared.")) {
                  regenerate.mutate({ triggerEventId: selectedTriggerId });
                }
              }}>
                <RefreshCw className="size-3.5 mr-1" /> Regenerate
              </Button>
            )}
            <Button size="sm" onClick={() => setAddCustomOpen(true)}>
              <Plus className="size-3.5 mr-1" /> Custom deadline
            </Button>
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deadlines here yet.</p>
        ) : (
          <div>
            {shown.map((d: any) => (
              <DeadlineRow
                key={d.id}
                deadline={{
                  id: d.id,
                  title: d.title,
                  dueDate: d.dueDate,
                  source: d.source,
                  shiftedReason: d.shiftedReason ?? null,
                  manualOverride: d.manualOverride,
                  completedAt: d.completedAt,
                }}
                onEdit={(row) => setEditDeadline(row)}
              />
            ))}
          </div>
        )}
      </section>

      <AddTriggerEventModal caseId={caseId} open={addTriggerOpen} onOpenChange={setAddTriggerOpen} />
      <AddCustomDeadlineModal caseId={caseId} open={addCustomOpen} onOpenChange={setAddCustomOpen} />
      <EditDeadlineModal deadline={editDeadline} open={!!editDeadline} onOpenChange={(v) => { if (!v) setEditDeadline(null); }} />
    </div>
  );
}
