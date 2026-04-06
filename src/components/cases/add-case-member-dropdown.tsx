"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export function AddCaseMemberDropdown({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: available = [] } = trpc.caseMembers.available.useQuery(
    { caseId },
    { enabled: open },
  );
  const utils = trpc.useUtils();

  const add = trpc.caseMembers.add.useMutation({
    onSuccess: () => {
      utils.caseMembers.list.invalidate({ caseId });
      utils.caseMembers.available.invalidate({ caseId });
    },
  });

  const filtered = available.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="size-6" />}>
        <Plus className="size-3.5 text-indigo-400" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <Input
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 h-8 text-xs"
        />
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {filtered.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                add.mutate({ caseId, userId: u.id });
                setOpen(false);
                setSearch("");
              }}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800 transition-colors"
            >
              <div className="text-xs text-zinc-200">{u.name}</div>
              <div className="text-[10px] text-zinc-500">{u.email}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-zinc-500 px-2 py-1">No available members</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
