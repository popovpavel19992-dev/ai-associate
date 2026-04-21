"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "filing", label: "Filing" },
  { value: "discovery", label: "Discovery" },
  { value: "hearing", label: "Hearing" },
  { value: "settlement", label: "Settlement" },
  { value: "communication", label: "Communication" },
  { value: "other", label: "Other" },
];

function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

interface Props {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (milestoneId: string) => void;
}

export function NewMilestoneModal({ caseId, open, onOpenChange, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("filing");
  const [dateStr, setDateStr] = useState<string>(todayISO());
  const utils = trpc.useUtils();

  const create = trpc.milestones.createDraft.useMutation({
    onSuccess: async (res) => {
      toast.success("Draft created");
      await utils.milestones.list.invalidate({ caseId });
      onCreated?.(res.milestoneId);
      setTitle(""); setCategory("filing"); setDateStr(todayISO());
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    if (!title.trim()) { toast.error("Title required"); return; }
    create.mutate({
      caseId,
      title: title.trim(),
      category: category as any,
      occurredAt: new Date(dateStr),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Milestone</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Filed complaint" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? "filing")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
