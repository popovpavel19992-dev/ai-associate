"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ACTIVITY_TYPES, ACTIVITY_LABELS } from "@/lib/billing";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface TimerStartDialogProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TimerStartDialog({ caseId, open, onOpenChange }: TimerStartDialogProps) {
  const utils = trpc.useUtils();
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]>("other");
  const [description, setDescription] = useState("");

  const startTimer = trpc.timeEntries.startTimer.useMutation({
    onSuccess: () => {
      utils.timeEntries.getRunningTimer.invalidate();
      toast.success("Timer started");
      onOpenChange(false);
      setDescription("");
      setActivityType("other");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTimer.mutate({ caseId, activityType, description });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start Timer</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Label htmlFor="timer-description">Description (optional)</Label>
            <Textarea
              id="timer-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you working on?"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={startTimer.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={startTimer.isPending}>
              {startTimer.isPending ? "Starting…" : "Start Timer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
