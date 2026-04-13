"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ACTIVITY_TYPES, ACTIVITY_LABELS } from "@/lib/billing";
import type { TimeEntry } from "@/server/db/schema/time-entries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface TimeEntryFormDialogProps {
  caseId: string;
  entry?: TimeEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function TimeEntryFormDialog({
  caseId,
  entry,
  open,
  onOpenChange,
}: TimeEntryFormDialogProps) {
  const utils = trpc.useUtils();
  const isEdit = !!entry;

  const [entryDate, setEntryDate] = useState(todayString());
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]>("other");
  const [description, setDescription] = useState("");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  const [isBillable, setIsBillable] = useState(true);

  // Populate form when editing
  useEffect(() => {
    if (open && entry) {
      setEntryDate(
        entry.entryDate instanceof Date
          ? entry.entryDate.toISOString().slice(0, 10)
          : String(entry.entryDate).slice(0, 10),
      );
      setActivityType(entry.activityType);
      setDescription(entry.description);
      setHours(String(Math.floor(entry.durationMinutes / 60)));
      setMinutes(String(entry.durationMinutes % 60));
      setIsBillable(entry.isBillable);
    } else if (open && !entry) {
      setEntryDate(todayString());
      setActivityType("other");
      setDescription("");
      setHours("0");
      setMinutes("30");
      setIsBillable(true);
    }
  }, [open, entry]);

  const create = trpc.timeEntries.create.useMutation({
    onSuccess: () => {
      utils.timeEntries.list.invalidate({ caseId });
      toast.success("Time entry added");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const update = trpc.timeEntries.update.useMutation({
    onSuccess: () => {
      utils.timeEntries.list.invalidate({ caseId });
      toast.success("Time entry updated");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const isPending = create.isPending || update.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const durationMinutes = Math.max(1, parseInt(hours) * 60 + parseInt(minutes));

    if (isEdit && entry) {
      update.mutate({
        id: entry.id,
        activityType,
        description,
        durationMinutes,
        isBillable,
        entryDate,
      });
    } else {
      create.mutate({
        caseId,
        activityType,
        description,
        durationMinutes,
        isBillable,
        entryDate,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Time Entry" : "Add Time Entry"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="entry-date">Date</Label>
            <Input
              id="entry-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Activity Type</Label>
            <Select
              value={activityType}
              onValueChange={(v) => setActivityType(v as (typeof ACTIVITY_TYPES)[number])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ACTIVITY_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What did you work on?"
              rows={3}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Duration</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                max="23"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-20"
              />
              <span className="text-sm text-zinc-400">hr</span>
              <Input
                type="number"
                min="0"
                max="59"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="w-20"
              />
              <span className="text-sm text-zinc-400">min</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="is-billable"
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-600 accent-white"
            />
            <Label htmlFor="is-billable" className="cursor-pointer">
              Billable
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
