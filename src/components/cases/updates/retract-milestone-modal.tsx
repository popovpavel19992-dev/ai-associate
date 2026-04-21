"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  milestoneId: string;
  caseId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RetractMilestoneModal({ milestoneId, caseId, title, open, onOpenChange }: Props) {
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const retract = trpc.milestones.retract.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Retracted");
      setReason("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Retract: {title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Reason (optional, shown to client)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why is this being retracted?" />
          <p className="text-xs text-muted-foreground">
            The client will see a retracted marker and any reason you provide. This cannot be undone.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => retract.mutate({ milestoneId, reason: reason.trim() || undefined })}
            disabled={retract.isPending}
          >
            {retract.isPending ? "Retracting…" : "Retract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
