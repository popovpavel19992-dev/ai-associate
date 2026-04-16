// src/components/clients/quick-create-client-dialog.tsx
"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (client: { id: string; displayName: string; clientType: "individual" | "organization" }) => void;
}

export function QuickCreateClientDialog({ open, onOpenChange, onCreated }: Props) {
  const [type, setType] = useState<"individual" | "organization">("individual");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");

  const [conflictName, setConflictName] = useState("");
  const conflictCheck = trpc.clients.checkConflict.useQuery(
    { name: conflictName },
    { enabled: conflictName.length >= 2 },
  );
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerConflictCheck = (name: string) => {
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(() => setConflictName(name), 500);
  };

  const create = trpc.clients.create.useMutation({
    onSuccess: ({ client }) => {
      toast.success("Client created");
      onCreated({ id: client.id, displayName: client.displayName, clientType: client.clientType });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (type === "individual") {
      create.mutate({ clientType: "individual", firstName, lastName, country: "US" });
    } else {
      create.mutate({ clientType: "organization", companyName, country: "US" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick create client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={type === "individual" ? "default" : "outline"} size="sm" onClick={() => setType("individual")}>Individual</Button>
            <Button variant={type === "organization" ? "default" : "outline"} size="sm" onClick={() => setType("organization")}>Organization</Button>
          </div>
          {type === "individual" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>First name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} onBlur={() => { const fullName = `${firstName} ${lastName}`.trim(); if (fullName.length >= 2) triggerConflictCheck(fullName); }} /></div>
            </div>
          ) : (
            <div className="space-y-1"><Label>Company name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} onBlur={() => { if (companyName.trim().length >= 2) triggerConflictCheck(companyName.trim()); }} /></div>
          )}
        </div>
        {conflictCheck.data?.matches && conflictCheck.data.matches.length > 0 && (
          <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-yellow-500">Potential conflict of interest</p>
                {conflictCheck.data.matches.map((m) => (
                  <p key={m.caseId} className="text-muted-foreground">
                    &ldquo;{m.opposingParty || m.opposingCounsel}&rdquo; in case{" "}
                    <span className="font-medium">{m.caseName}</span>
                    {m.clientDisplayName && <> (client: {m.clientDisplayName})</>}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={
              create.isPending ||
              (type === "individual" ? !firstName.trim() || !lastName.trim() : !companyName.trim())
            }
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
