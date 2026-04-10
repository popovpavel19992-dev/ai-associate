// src/components/clients/contact-form-dialog.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  initial?: {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    notes: string | null;
  };
}

export function ContactFormDialog({ open, onOpenChange, clientId, initial }: Props) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [isPrimary, setIsPrimary] = useState(initial?.isPrimary ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const onDone = () => {
    utils.clients.getById.invalidate({ id: clientId });
    onOpenChange(false);
    toast.success(initial ? "Contact updated" : "Contact added");
  };

  const create = trpc.clientContacts.create.useMutation({ onSuccess: onDone, onError: (e) => toast.error(e.message) });
  const update = trpc.clientContacts.update.useMutation({ onSuccess: onDone, onError: (e) => toast.error(e.message) });

  const submit = () => {
    const payload = {
      name,
      title: title || undefined,
      email: email || undefined,
      phone: phone || undefined,
      isPrimary,
      notes: notes || undefined,
    };
    if (initial) update.mutate({ id: initial.id, patch: payload });
    else create.mutate({ clientId, ...payload });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary contact
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || create.isPending || update.isPending}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
