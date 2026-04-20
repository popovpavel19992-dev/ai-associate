// src/components/cases/requests/new-request-modal.tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface NewRequestModalProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (requestId: string) => void;
}

export function NewRequestModal({ caseId, open, onOpenChange, onCreated }: NewRequestModalProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [items, setItems] = useState<Array<{ name: string; description: string }>>([{ name: "", description: "" }]);
  const utils = trpc.useUtils();

  const create = trpc.documentRequests.create.useMutation({
    onSuccess: async (res) => {
      toast.success("Request sent to client");
      await utils.documentRequests.list.invalidate({ caseId });
      onCreated?.(res.requestId);
      reset();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  function reset() {
    setTitle("");
    setNote("");
    setDueAt("");
    setItems([{ name: "", description: "" }]);
  }

  function submit() {
    const cleanItems = items
      .filter((i) => i.name.trim())
      .map((i) => ({
        name: i.name.trim(),
        description: i.description.trim() || undefined,
      }));
    if (!title.trim() || cleanItems.length === 0) {
      toast.error("Title and at least one item required");
      return;
    }
    create.mutate({
      caseId,
      title: title.trim(),
      note: note.trim() || undefined,
      dueAt: dueAt ? new Date(dueAt) : undefined,
      items: cleanItems,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Document Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intake Documents" />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Context for the client" />
          </div>
          <div>
            <Label>Due date (optional)</Label>
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div>
            <Label>Items</Label>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    className="flex-1"
                    value={it.name}
                    onChange={(e) =>
                      setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p)))
                    }
                    placeholder="Document name"
                  />
                  <Input
                    className="flex-1"
                    value={it.description}
                    onChange={(e) =>
                      setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, description: e.target.value } : p)))
                    }
                    placeholder="Description (optional)"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setItems((prev) => [...prev, { name: "", description: "" }])}
              >
                <Plus className="w-4 h-4 mr-1" /> Add item
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Sending…" : "Send to client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
