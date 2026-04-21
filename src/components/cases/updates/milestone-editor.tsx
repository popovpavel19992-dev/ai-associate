"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "filing", label: "Filing" },
  { value: "discovery", label: "Discovery" },
  { value: "hearing", label: "Hearing" },
  { value: "settlement", label: "Settlement" },
  { value: "communication", label: "Communication" },
  { value: "other", label: "Other" },
];

interface Props {
  milestoneId: string;
  caseId: string;
  initial: {
    title: string;
    description: string | null;
    category: string;
    occurredAt: string | Date;
    documentId: string | null;
  };
}

export function MilestoneEditor({ milestoneId, caseId, initial }: Props) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [category, setCategory] = useState(initial.category);
  const [dateStr, setDateStr] = useState(
    typeof initial.occurredAt === "string"
      ? initial.occurredAt.slice(0, 10)
      : new Date(initial.occurredAt).toISOString().slice(0, 10),
  );

  const update = trpc.milestones.updateDraft.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const publish = trpc.milestones.publish.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Published");
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.milestones.deleteDraft.useMutation({
    onSuccess: async () => {
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  function saveDraft() {
    update.mutate({
      milestoneId,
      title: title.trim(),
      description: description.trim() || null,
      category: category as any,
      occurredAt: new Date(dateStr),
    });
  }

  function handlePublish() {
    if (!title.trim()) { toast.error("Title required"); return; }
    update.mutate(
      {
        milestoneId,
        title: title.trim(),
        description: description.trim() || null,
        category: category as any,
        occurredAt: new Date(dateStr),
      },
      { onSuccess: () => publish.mutate({ milestoneId }) },
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What happened and why it matters to the client" />
      </div>
      <div className="grid grid-cols-2 gap-3">
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
      <div className="flex justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={() => del.mutate({ milestoneId })} disabled={del.isPending}>
          <Trash2 className="w-4 h-4 mr-1" /> Delete draft
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={saveDraft} disabled={update.isPending}>Save draft</Button>
          <Button onClick={handlePublish} disabled={update.isPending || publish.isPending}>
            <Send className="w-4 h-4 mr-1" /> Publish
          </Button>
        </div>
      </div>
    </div>
  );
}
