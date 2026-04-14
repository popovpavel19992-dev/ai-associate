"use client";

import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface CaseMuteButtonProps {
  caseId: string;
}

export function CaseMuteButton({ caseId }: CaseMuteButtonProps) {
  const utils = trpc.useUtils();

  const { data } = trpc.notificationMutes.isMuted.useQuery({ caseId });
  const isMuted = data?.muted ?? false;

  const mute = trpc.notificationMutes.mute.useMutation({
    onSuccess: () => utils.notificationMutes.isMuted.invalidate({ caseId }),
  });

  const unmute = trpc.notificationMutes.unmute.useMutation({
    onSuccess: () => utils.notificationMutes.isMuted.invalidate({ caseId }),
  });

  const isPending = mute.isPending || unmute.isPending;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        isMuted ? unmute.mutate({ caseId }) : mute.mutate({ caseId })
      }
    >
      {isMuted ? (
        <>
          <BellOff className="mr-1.5 h-3.5 w-3.5" />
          Muted
        </>
      ) : (
        <>
          <Bell className="mr-1.5 h-3.5 w-3.5" />
          Mute
        </>
      )}
    </Button>
  );
}
