// src/components/clients/contact-row.tsx
"use client";

import { useState } from "react";
import { Star, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ContactFormDialog } from "./contact-form-dialog";

interface Props {
  contact: {
    id: string;
    clientId: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    notes: string | null;
  };
}

export function ContactRow({ contact }: Props) {
  const [editing, setEditing] = useState(false);
  const utils = trpc.useUtils();

  const setPrimary = trpc.clientContacts.setPrimary.useMutation({
    onSuccess: () => utils.clients.getById.invalidate({ id: contact.clientId }),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.clientContacts.delete.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: contact.clientId });
      toast.success("Contact deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex items-start justify-between rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{contact.name}</span>
            {contact.isPrimary && (
              <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                Primary
              </span>
            )}
          </div>
          {contact.title && <div className="text-xs text-zinc-500">{contact.title}</div>}
          {contact.email && <div className="text-xs text-zinc-600 dark:text-zinc-400">{contact.email}</div>}
          {contact.phone && <div className="text-xs text-zinc-600 dark:text-zinc-400">{contact.phone}</div>}
        </div>
        <div className="flex gap-1">
          {!contact.isPrimary && (
            <Button variant="ghost" size="sm" onClick={() => setPrimary.mutate({ id: contact.id })}>
              <Star className="h-3 w-3" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => remove.mutate({ id: contact.id })}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ContactFormDialog
        open={editing}
        onOpenChange={setEditing}
        clientId={contact.clientId}
        initial={contact}
      />
    </>
  );
}
