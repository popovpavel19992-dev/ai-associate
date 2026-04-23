// src/components/cases/deadlines/add-custom-deadline-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function AddCustomDeadlineModal({
  caseId, open, onOpenChange,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [remindersStr, setRemindersStr] = React.useState("7,3,1");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) { setTitle(""); setDueDate(""); setRemindersStr("7,3,1"); setNotes(""); }
  }, [open]);

  const create = trpc.deadlines.createManualDeadline.useMutation({
    onSuccess: async () => {
      toast.success("Deadline added");
      await utils.deadlines.listForCase.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function parseReminders(s: string): number[] {
    return s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n >= 0).slice(0, 5);
  }

  const canSubmit = title.trim() && dueDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add custom deadline</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} /></div>
          <div><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div>
            <Label>Reminders (days before, comma-separated)</Label>
            <Input value={remindersStr} onChange={(e) => setRemindersStr(e.target.value)} placeholder="7,3,1" />
          </div>
          <div><Label>Notes (optional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate({
              caseId,
              title: title.trim(),
              dueDate,
              reminders: parseReminders(remindersStr),
              notes: notes || undefined,
            })}
          >
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
