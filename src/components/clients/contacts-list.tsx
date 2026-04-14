// src/components/clients/contacts-list.tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactRow } from "./contact-row";
import { ContactFormDialog } from "./contact-form-dialog";

interface Contact {
  id: string;
  clientId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
}

export function ContactsList({ clientId, contacts }: { clientId: string; contacts: Contact[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Contacts</h3>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      {contacts.length === 0 ? (
        <p className="text-sm text-zinc-500">No contacts yet.</p>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} />
          ))}
        </div>
      )}
      <ContactFormDialog open={adding} onOpenChange={setAdding} clientId={clientId} />
    </section>
  );
}
