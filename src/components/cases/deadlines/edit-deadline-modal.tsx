// src/components/cases/deadlines/edit-deadline-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function EditDeadlineModal({
  deadline,
  open,
  onOpenChange,
}: {
  deadline: { id: string; title: string; dueDate: string; notes?: string | null } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open && deadline) {
      setTitle(deadline.title);
      setDueDate(deadline.dueDate);
      setNotes(deadline.notes ?? "");
    }
  }, [open, deadline]);

  const update = trpc.deadlines.updateDeadline.useMutation({
    onSuccess: async () => {
      toast.success("Saved (manual override applied)");
      await utils.deadlines.listForCase.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!deadline) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit deadline</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} /></div>
          <div><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} /></div>
          <p className="text-xs text-muted-foreground">
            Saving flags this deadline as manually overridden — it won&apos;t recompute when the trigger date changes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={update.isPending}
            onClick={() => update.mutate({
              deadlineId: deadline.id,
              title: title.trim(),
              dueDate,
              notes: notes || undefined,
            })}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
