// src/components/clients/quick-create-client-dialog.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  ConflictReviewModal,
  type ReviewHit,
  type Severity,
} from "@/components/conflict-checker/conflict-review-modal";

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

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewHits, setReviewHits] = useState<ReviewHit[]>([]);
  const [reviewSeverity, setReviewSeverity] = useState<Severity | null>(null);
  const [pendingLogId, setPendingLogId] = useState<string | null>(null);

  const runConflictCheck = trpc.conflictChecker.runCheck.useMutation();
  const recordOverride = trpc.conflictChecker.recordOverride.useMutation();
  const attachTarget = trpc.conflictChecker.attachTarget.useMutation();

  const create = trpc.clients.create.useMutation({
    onSuccess: async ({ client }) => {
      if (pendingLogId) {
        try {
          await attachTarget.mutateAsync({ logId: pendingLogId, clientId: client.id });
        } catch {
          /* non-fatal */
        }
      }
      toast.success("Client created");
      onCreated({ id: client.id, displayName: client.displayName, clientType: client.clientType });
      onOpenChange(false);
      setReviewOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const queryName = () =>
    type === "individual" ? `${firstName} ${lastName}`.trim() : companyName.trim();

  const doCreate = () => {
    if (type === "individual") {
      create.mutate({ clientType: "individual", firstName, lastName, country: "US" });
    } else {
      create.mutate({ clientType: "organization", companyName, country: "US" });
    }
  };

  const submit = async () => {
    const name = queryName();
    if (!name) return;
    try {
      const result = await runConflictCheck.mutateAsync({
        name,
        context: "client_create",
      });
      setPendingLogId(result.logId);
      if (result.hits.length > 0) {
        setReviewHits(result.hits as ReviewHit[]);
        setReviewSeverity(result.highestSeverity);
        setReviewOpen(true);
        return;
      }
      doCreate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleOverride = async (reason: string) => {
    if (!pendingLogId) return;
    // Create first, then record the override against the new clientId.
    create.mutate(
      type === "individual"
        ? { clientType: "individual", firstName, lastName, country: "US" }
        : { clientType: "organization", companyName, country: "US" },
      {
        onSuccess: async ({ client }) => {
          try {
            await recordOverride.mutateAsync({
              logId: pendingLogId,
              clientId: client.id,
              reason,
            });
          } catch (e) {
            toast.error((e as Error).message);
          }
        },
      },
    );
  };

  const isPending = create.isPending || runConflictCheck.isPending || recordOverride.isPending;

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
              isPending ||
              (type === "individual" ? !firstName.trim() || !lastName.trim() : !companyName.trim())
            }
          >
            Create
          </Button>
        </div>

        <ConflictReviewModal
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          hits={reviewHits}
          highestSeverity={reviewSeverity}
          onCancel={() => setReviewOpen(false)}
          onOverride={handleOverride}
          isOverriding={isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
