// src/components/clients/quick-create-client-dialog.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
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
              <div className="space-y-1"><Label>Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
            </div>
          ) : (
            <div className="space-y-1"><Label>Company name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
          )}
        </div>
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
