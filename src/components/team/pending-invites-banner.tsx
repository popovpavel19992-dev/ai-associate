"use client";

import { Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function PendingInvitesBanner() {
  const { data: invites = [] } = trpc.team.pendingInvites.useQuery();
  const utils = trpc.useUtils();
  const cancel = trpc.team.cancelInvite.useMutation({
    onSuccess: () => utils.team.pendingInvites.invalidate(),
  });

  if (invites.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 space-y-2">
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Clock className="size-3.5 text-amber-400" />
            <span>
              Pending invitation — <span className="text-zinc-200">{inv.emailAddress}</span>{" "}
              <span className="text-xs text-zinc-500">({inv.role})</span>
            </span>
          </div>
          <button
            onClick={() => cancel.mutate({ invitationId: inv.id })}
            disabled={cancel.isPending}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
