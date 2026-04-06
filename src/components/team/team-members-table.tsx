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

function roleBadgeClass(role: string | null) {
  switch (role) {
    case "owner":
      return "bg-violet-900/50 text-violet-300";
    case "admin":
      return "bg-sky-900/50 text-sky-300";
    default:
      return "bg-emerald-900/50 text-emerald-300";
  }
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TeamMembersTable({
  currentUserRole,
  currentUserId,
}: {
  currentUserRole: string;
  currentUserId: string;
}) {
  const { data: members = [] } = trpc.team.list.useQuery();
  const utils = trpc.useUtils();

  const updateRole = trpc.team.updateRole.useMutation({
    onSuccess: () => utils.team.list.invalidate(),
  });
  const removeMember = trpc.team.removeMember.useMutation({
    onSuccess: () => utils.team.list.invalidate(),
  });

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <div className="grid grid-cols-[2fr_1fr_1fr_60px] gap-4 px-4 py-2.5 bg-zinc-900/50 text-xs uppercase tracking-wider text-zinc-500">
        <div>Member</div>
        <div>Role</div>
        <div>Cases</div>
        <div />
      </div>
      {members.map((m) => (
        <div
          key={m.id}
          className="grid grid-cols-[2fr_1fr_1fr_60px] gap-4 px-4 py-3 border-t border-zinc-800 items-center"
        >
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs text-white font-medium">
              {initials(m.name)}
            </div>
            <div>
              <div className="text-sm text-zinc-200">{m.name}</div>
              <div className="text-xs text-zinc-500">{m.email}</div>
            </div>
          </div>
          <div>
            <span className={`inline-block rounded px-2 py-0.5 text-xs ${roleBadgeClass(m.role)}`}>
              {m.role ?? "member"}
            </span>
          </div>
          <div className="text-sm text-zinc-400">{m.caseCount} cases</div>
          <div>
            {m.id !== currentUserId && m.role !== "owner" && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {currentUserRole === "owner" && (
                    <DropdownMenuItem
                      onClick={() =>
                        updateRole.mutate({
                          userId: m.id,
                          role: m.role === "admin" ? "member" : "admin",
                        })
                      }
                    >
                      {m.role === "admin" ? "Demote to Member" : "Promote to Admin"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-red-400"
                    onClick={() => removeMember.mutate({ userId: m.id })}
                  >
                    Remove from team
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
