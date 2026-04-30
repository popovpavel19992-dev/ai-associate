"use client";

// src/components/cases/reassign-lead-modal.tsx
// Phase 3.15 — Modal picker for bulk-reassigning the lead attorney across N cases.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

export interface ReassignLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: (newLeadUserId: string) => void;
  pending?: boolean;
}

export function ReassignLeadModal({
  open,
  onOpenChange,
  count,
  onConfirm,
  pending,
}: ReassignLeadModalProps) {
  const { data: members, isLoading } = trpc.team.list.useQuery(undefined, {
    enabled: open,
  });
  const [selected, setSelected] = useState<string>("");

  const selectedMember = members?.find((m) => m.id === selected);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign Lead</DialogTitle>
          <DialogDescription>
            Choose a team member to set as lead attorney on {count} case(s).
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-zinc-800 p-2">
          {isLoading && (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading team…
            </div>
          )}
          {!isLoading && (members ?? []).length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No team members found.
            </div>
          )}
          {(members ?? []).map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-zinc-900 ${
                selected === m.id ? "bg-zinc-900" : ""
              }`}
            >
              <input
                type="radio"
                name="new-lead"
                value={m.id}
                checked={selected === m.id}
                onChange={() => setSelected(m.id)}
              />
              <div className="flex-1">
                <div className="font-medium">{m.name ?? m.email}</div>
                <div className="text-xs text-muted-foreground">
                  {m.email} · {m.role}
                </div>
              </div>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || pending}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Reassign{selectedMember ? ` to ${selectedMember.name ?? selectedMember.email}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
