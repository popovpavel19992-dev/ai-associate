// src/components/research/add-to-collection-menu.tsx
"use client";

import * as React from "react";
import { Library, Plus, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { CreateCollectionDialog } from "./create-collection-dialog";

interface AddToCollectionMenuProps {
  itemType: "opinion" | "statute" | "memo" | "session";
  itemId: string;
  buttonLabel?: string;
  size?: "sm" | "default";
}

export function AddToCollectionMenu({ itemType, itemId, buttonLabel, size = "sm" }: AddToCollectionMenuProps) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const utils = trpc.useUtils();
  const { data } = trpc.research.collections.listForArtifact.useQuery({ itemType, itemId });
  const addMut = trpc.research.collections.addItem.useMutation();

  const inCount = (data?.collections ?? []).filter((c) => c.hasItem).length;

  const onAdd = async (collectionId: string, currentlyIn: boolean) => {
    if (currentlyIn) return; // remove path lives on the collection detail page
    await addMut.mutateAsync({ collectionId, item: { type: itemType, id: itemId } });
    await utils.research.collections.listForArtifact.invalidate({ itemType, itemId });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size={size} />}>
          <Library className="mr-1 size-3.5" aria-hidden />
          {buttonLabel ?? "Collections"}
          {inCount > 0 && <span className="ml-1.5 rounded bg-muted px-1 text-xs">{inCount}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Add to collection</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(data?.collections ?? []).length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No collections yet
            </DropdownMenuItem>
          ) : (
            (data?.collections ?? []).map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={(e) => {
                  e.preventDefault();
                  onAdd(c.id, c.hasItem);
                }}
                className="flex items-center justify-between"
              >
                <span className="truncate">{c.name}</span>
                {c.hasItem && <Check className="ml-2 size-4 text-emerald-500" aria-label="Already in" />}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCreateOpen(true); }}>
            <Plus className="mr-2 size-4" aria-hidden />
            Create new collection…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateCollectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        prefillItem={{ type: itemType, id: itemId }}
      />
    </>
  );
}
