// src/components/cases/intake/new-intake-form-modal.tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface NewIntakeFormModalProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (formId: string) => void;
}

export function NewIntakeFormModal({ caseId, open, onOpenChange, onCreated }: NewIntakeFormModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const utils = trpc.useUtils();

  const create = trpc.intakeForms.createDraft.useMutation({
    onSuccess: async (res) => {
      toast.success("Form created");
      await utils.intakeForms.list.invalidate({ caseId });
      onCreated?.(res.formId);
      setTitle(""); setDescription("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    if (!title.trim()) { toast.error("Title required"); return; }
    create.mutate({
      caseId,
      title: title.trim(),
      description: description.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Intake Form</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Initial Intake" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="Brief context for the client" />
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
