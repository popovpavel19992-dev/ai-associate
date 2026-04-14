// src/components/clients/client-notes.tsx
"use client";

import { useState } from "react";
import { Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export function ClientNotes({ client }: { client: { id: string; notes: string | null } }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(client.notes ?? "");

  const update = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      setEditing(false);
      toast.success("Saved");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <section className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Notes</h3>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setValue(client.notes ?? ""); }}>
              <X className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: client.id, patch: { notes: value } })} disabled={update.isPending}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <Textarea rows={5} value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} />
      ) : (
        <p className="text-sm whitespace-pre-line text-zinc-600 dark:text-zinc-400">{client.notes || "—"}</p>
      )}
    </section>
  );
}
