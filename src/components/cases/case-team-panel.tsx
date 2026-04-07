"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { AddCaseMemberDropdown } from "./add-case-member-dropdown";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function CaseTeamPanel({
  caseId,
  userRole,
}: {
  caseId: string;
  userRole: string | null;
}) {
  const { data: members = [] } = trpc.caseMembers.list.useQuery({ caseId });
  const utils = trpc.useUtils();
  const isAdmin = userRole === "owner" || userRole === "admin";

  const remove = trpc.caseMembers.remove.useMutation({
    onSuccess: () => {
      utils.caseMembers.list.invalidate({ caseId });
      utils.caseMembers.available.invalidate({ caseId });
    },
  });
  const updateRole = trpc.caseMembers.updateRole.useMutation({
    onSuccess: () => utils.caseMembers.list.invalidate({ caseId }),
  });

  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Case Team</h3>
        {isAdmin && <AddCaseMemberDropdown caseId={caseId} />}
      </div>

      <div className="space-y-2.5">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between group">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] text-white font-medium">
                {initials(m.userName)}
              </div>
              <div>
                <div className="text-xs text-zinc-200">{m.userName}</div>
                <div className="text-[10px] text-zinc-500">
                  {m.role === "lead" ? (
                    <span className="text-indigo-400">Lead</span>
                  ) : (
                    "Contributor"
                  )}
                </div>
              </div>
            </div>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 opacity-0 group-hover:opacity-100"
                    />
                  }
                >
                  <MoreHorizontal className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      updateRole.mutate({
                        caseId,
                        userId: m.userId,
                        role: m.role === "lead" ? "contributor" : "lead",
                      })
                    }
                  >
                    {m.role === "lead" ? "Set as Contributor" : "Set as Lead"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-400"
                    onClick={() => remove.mutate({ caseId, userId: m.userId })}
                  >
                    Remove from case
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="text-xs text-zinc-500">No team members assigned.</p>
        )}
      </div>
    </div>
  );
}
