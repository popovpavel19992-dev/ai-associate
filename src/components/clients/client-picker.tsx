// src/components/clients/client-picker.tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { ClientTypeBadge } from "./client-type-badge";
import { QuickCreateClientDialog } from "./quick-create-client-dialog";

interface Picked {
  id: string;
  displayName: string;
  clientType: "individual" | "organization";
}

export function ClientPicker({
  value,
  onChange,
}: {
  value: Picked | null;
  onChange: (client: Picked | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  const search = trpc.clients.searchForPicker.useQuery(
    { q: debounced, limit: 10 },
    { enabled: debounced.trim().length > 0 },
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={(props) => (
          <Button {...props} variant="outline" className="w-full justify-between">
            {value ? value.displayName : "Select client..."}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        )} />
        <PopoverContent className="w-[320px] p-0" align="start">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute top-2.5 left-2 h-4 w-4 text-zinc-400" />
              <Input
                autoFocus
                placeholder="Search clients..."
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {search.isLoading && debounced && (
              <p className="p-2 text-xs text-zinc-500">Searching…</p>
            )}
            {(search.data?.clients ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between rounded p-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                <span>{c.displayName}</span>
                <ClientTypeBadge type={c.clientType} />
              </button>
            ))}
            {debounced && !search.isLoading && (search.data?.clients?.length ?? 0) === 0 && (
              <p className="p-2 text-xs text-zinc-500">No clients found.</p>
            )}
          </div>
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setShowQuickCreate(true);
                setOpen(false);
              }}
            >
              <Plus className="mr-2 h-3 w-3" />
              Create new client
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <QuickCreateClientDialog
        open={showQuickCreate}
        onOpenChange={setShowQuickCreate}
        onCreated={(c) => onChange(c)}
      />
    </>
  );
}
