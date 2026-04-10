// src/components/clients/client-address-section.tsx
"use client";

import { useState } from "react";
import { Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

interface Props {
  client: {
    id: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    country: string | null;
  };
}

export function ClientAddressSection({ client }: Props) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(client);

  const update = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      setEditing(false);
      toast.success("Saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const save = () =>
    update.mutate({
      id: client.id,
      patch: {
        addressLine1: draft.addressLine1 ?? undefined,
        addressLine2: draft.addressLine2 ?? undefined,
        city: draft.city ?? undefined,
        state: draft.state ?? undefined,
        zipCode: draft.zipCode ?? undefined,
        country: draft.country ?? undefined,
      },
    });

  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Address</h3>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(client); }}>
              <X className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={save} disabled={update.isPending}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="grid grid-cols-2 gap-2">
          <Input className="col-span-2" placeholder="Line 1" value={draft.addressLine1 ?? ""} onChange={(e) => setDraft({ ...draft, addressLine1: e.target.value })} />
          <Input className="col-span-2" placeholder="Line 2" value={draft.addressLine2 ?? ""} onChange={(e) => setDraft({ ...draft, addressLine2: e.target.value })} />
          <Input placeholder="City" value={draft.city ?? ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          <Input placeholder="State" value={draft.state ?? ""} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
          <Input placeholder="ZIP" value={draft.zipCode ?? ""} onChange={(e) => setDraft({ ...draft, zipCode: e.target.value })} />
          <Input placeholder="Country" maxLength={2} value={draft.country ?? ""} onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })} />
        </div>
      ) : (
        <p className="text-sm whitespace-pre-line">
          {[client.addressLine1, client.addressLine2, [client.city, client.state, client.zipCode].filter(Boolean).join(", "), client.country]
            .filter(Boolean)
            .join("\n") || "—"}
        </p>
      )}
    </section>
  );
}
