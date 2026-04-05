"use client";

import { useRouter } from "next/navigation";
import { Loader2, FileDown, RefreshCw, SendHorizonal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { DraftStatus } from "@/lib/types";

interface DraftActionBarProps {
  draftId: string;
  status: DraftStatus;
}

export function DraftActionBar({ draftId, status }: DraftActionBarProps) {
  const router = useRouter();

  const regenerate = trpc.drafts.regenerate.useMutation({
    onSuccess: () => {
      toast.success("Regeneration started (3 credits)");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const sendToReview = trpc.drafts.sendToReview.useMutation({
    onSuccess: (data) => {
      toast.success("Sent to review (2 credits)");
      router.push(`/contracts/${data.contractId}`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const isReady = status === "ready";
  const isBusy = regenerate.isPending || sendToReview.isPending;

  return (
    <div className="flex items-center gap-2 border-t bg-background px-4 py-3">
      <Button variant="outline" size="sm" disabled>
        <FileDown className="mr-1 h-3 w-3" />
        Export DOCX
      </Button>
      <Button variant="outline" size="sm" disabled>
        <FileDown className="mr-1 h-3 w-3" />
        Export PDF
      </Button>

      <div className="flex-1" />

      <Button
        variant="outline"
        size="sm"
        onClick={() => regenerate.mutate({ draftId })}
        disabled={isBusy}
      >
        {regenerate.isPending ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="mr-1 h-3 w-3" />
        )}
        Regenerate (3 credits)
      </Button>

      <Button
        size="sm"
        onClick={() => sendToReview.mutate({ draftId })}
        disabled={!isReady || isBusy}
      >
        {sendToReview.isPending ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <SendHorizonal className="mr-1 h-3 w-3" />
        )}
        Send to Review (2 credits)
      </Button>
    </div>
  );
}
