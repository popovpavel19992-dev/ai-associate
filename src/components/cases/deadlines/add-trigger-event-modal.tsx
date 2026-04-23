// src/components/cases/deadlines/add-trigger-event-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export function AddTriggerEventModal({
  caseId, open, onOpenChange,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [triggerEvent, setTriggerEvent] = React.useState("");
  const [eventDate, setEventDate] = React.useState("");
  const [jurisdiction, setJurisdiction] = React.useState("FRCP");
  const [notes, setNotes] = React.useState("");
  const [alsoPublish, setAlsoPublish] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTriggerEvent(""); setEventDate(""); setJurisdiction("FRCP"); setNotes(""); setAlsoPublish(false);
    }
  }, [open]);

  const types = trpc.deadlines.listTriggerEventTypes.useQuery(undefined, { enabled: open });

  const create = trpc.deadlines.createTriggerEvent.useMutation({
    onSuccess: async (res) => {
      toast.success(`Trigger created${res.deadlinesCreated > 0 ? ` — ${res.deadlinesCreated} deadlines generated` : ""}`);
      await utils.deadlines.listForCase.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = triggerEvent && eventDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add trigger event</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Event type</Label>
            <select className="w-full rounded border p-2" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
              <option value="">Pick event…</option>
              {(types.data?.triggerEvents ?? []).map((t) => (
                <option key={t.triggerEvent} value={t.triggerEvent}>{t.triggerEvent.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div>
            <Label>Jurisdiction</Label>
            <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="FRCP" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={alsoPublish} onChange={(e) => setAlsoPublish(e.target.checked)} />
            Also publish as milestone to client portal
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate({
              caseId, triggerEvent, eventDate, jurisdiction,
              notes: notes || undefined,
              alsoPublishAsMilestone: alsoPublish,
            })}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
