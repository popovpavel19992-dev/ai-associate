"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, GitCompareArrows } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CompareSelectorProps {
  contractId: string;
  onComparisonCreated: (comparisonId: string) => void;
}

export function CompareSelector({ contractId, onComparisonCreated }: CompareSelectorProps) {
  const [open, setOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { data: contracts, isLoading: loadingContracts } = trpc.contracts.list.useQuery(
    { limit: 100 },
    { enabled: open },
  );

  const createComparison = trpc.comparisons.create.useMutation({
    onSuccess: (data) => {
      setOpen(false);
      onComparisonCreated(data.comparison.id);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Filter to only analyzed (ready) contracts, excluding current
  const readyContracts = (contracts ?? []).filter(
    (c) => c.status === "ready" && c.id !== contractId,
  );

  function handleCompare() {
    if (!selectedContractId) return;
    setError(null);
    createComparison.mutate({
      contractAId: contractId,
      contractBId: selectedContractId,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <GitCompareArrows className="size-4" data-icon="inline-start" />
        Compare
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compare Contracts</DialogTitle>
          <DialogDescription>
            Select a second analyzed contract to compare against, or upload a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {loadingContracts ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : readyContracts.length > 0 ? (
            <Select value={selectedContractId} onValueChange={(v) => setSelectedContractId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a contract..." />
              </SelectTrigger>
              <SelectContent>
                {readyContracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">
              No other analyzed contracts found.
            </p>
          )}

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Link
            href="/contracts/new"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Plus className="size-4" />
            Upload a new contract
          </Link>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            onClick={handleCompare}
            disabled={!selectedContractId || createComparison.isPending}
          >
            {createComparison.isPending && (
              <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
            )}
            Compare
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
