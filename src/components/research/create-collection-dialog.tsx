// src/components/research/create-collection-dialog.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

interface CreateCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillItem?: { type: "opinion" | "statute" | "memo" | "session"; id: string };
  onCreated?: (collectionId: string) => void;
}

export function CreateCollectionDialog({
  open,
  onOpenChange,
  prefillItem,
  onCreated,
}: CreateCollectionDialogProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const utils = trpc.useUtils();
  const createMut = trpc.research.collections.create.useMutation();
  const addItemMut = trpc.research.collections.addItem.useMutation();

  React.useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  const submit = async () => {
    const out = await createMut.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    });
    if (prefillItem) {
      await addItemMut.mutateAsync({ collectionId: out.collectionId, item: prefillItem });
      await utils.research.collections.listForArtifact.invalidate({
        itemType: prefillItem.type,
        itemId: prefillItem.id,
      });
    }
    await utils.research.collections.list.invalidate();
    onCreated?.(out.collectionId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
          <DialogDescription>
            {prefillItem ? "The current item will be added on creation." : "Organize research artifacts into a named bucket."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="collection-name">Name</Label>
            <Input
              id="collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. Smith v. Jones research"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="collection-desc">Description (optional)</Label>
            <Textarea
              id="collection-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || createMut.isPending}>
            {createMut.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
