"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/billing";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RateOverrideDialogProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RateOverrideDialog({ caseId, open, onOpenChange }: RateOverrideDialogProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.billingRates.list.useQuery(undefined, { enabled: open });
  const upsert = trpc.billingRates.upsert.useMutation({
    onSuccess: () => {
      utils.billingRates.list.invalidate();
      toast.success("Rate override saved");
    },
    onError: (err) => toast.error(err.message),
  });

  // Map userId -> override rate value in dollars
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const rates = data?.rates ?? [];

  // Unique users from default rates
  const defaultRates = rates.filter((r) => r.caseId === null);

  // For each user, find existing case override
  function getCaseRate(userId: string) {
    return rates.find((r) => r.userId === userId && r.caseId === caseId);
  }

  function handleChange(userId: string, value: string) {
    setOverrides((prev) => ({ ...prev, [userId]: value }));
  }

  async function handleSave(userId: string) {
    const val = overrides[userId];
    if (val === undefined) return;
    const rateCents = Math.round(parseFloat(val || "0") * 100);
    await upsert.mutateAsync({ userId, rateCents, caseId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Case Rate Overrides</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <p className="py-4 text-center text-sm text-zinc-500">Loading…</p>
        )}

        {!isLoading && defaultRates.length === 0 && (
          <p className="py-4 text-center text-sm text-zinc-500">No team members with billing rates found.</p>
        )}

        {!isLoading && defaultRates.length > 0 && (
          <div className="space-y-3">
            {defaultRates.map((rate) => {
              const existing = getCaseRate(rate.userId);
              const currentOverrideDollars = overrides[rate.userId] ?? (
                existing ? (existing.rateCents / 100).toFixed(2) : ""
              );

              return (
                <div key={rate.userId} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-200">{rate.userName}</p>
                    <p className="text-xs text-zinc-500">
                      Default: {formatCents(rate.rateCents)}/hr
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="sr-only">Override rate</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Override…"
                      value={currentOverrideDollars}
                      onChange={(e) => handleChange(rate.userId, e.target.value)}
                      className="h-8 w-28 bg-zinc-900 border-zinc-800 text-zinc-200 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => handleSave(rate.userId)}
                      disabled={upsert.isPending || !overrides[rate.userId]}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
