// src/components/clients/client-info-section.tsx
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
    clientType: "individual" | "organization";
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    industry: string | null;
    website: string | null;
    ein: string | null;
  };
}

export function ClientInfoSection({ client }: Props) {
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

  const save = () => {
    if (client.clientType === "individual") {
      update.mutate({
        id: client.id,
        patch: {
          firstName: draft.firstName ?? undefined,
          lastName: draft.lastName ?? undefined,
        },
      });
    } else {
      update.mutate({
        id: client.id,
        patch: {
          companyName: draft.companyName ?? undefined,
          industry: draft.industry ?? undefined,
          website: draft.website ?? undefined,
          ein: draft.ein ?? undefined,
        },
      });
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Info</h3>
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

      {client.clientType === "individual" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={draft.firstName} editing={editing}
            onChange={(v) => setDraft({ ...draft, firstName: v })} />
          <Field label="Last name" value={draft.lastName} editing={editing}
            onChange={(v) => setDraft({ ...draft, lastName: v })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" value={draft.companyName} editing={editing}
            onChange={(v) => setDraft({ ...draft, companyName: v })} />
          <Field label="Industry" value={draft.industry} editing={editing}
            onChange={(v) => setDraft({ ...draft, industry: v })} />
          <Field label="Website" value={draft.website} editing={editing}
            onChange={(v) => setDraft({ ...draft, website: v })} />
          <Field label="EIN" value={draft.ein} editing={editing}
            onChange={(v) => setDraft({ ...draft, ein: v })} />
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: string | null;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-zinc-500">{label}</Label>
      {editing ? (
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <p className="text-sm">{value || "—"}</p>
      )}
    </div>
  );
}
