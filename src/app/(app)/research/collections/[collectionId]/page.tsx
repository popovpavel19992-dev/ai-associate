// src/app/(app)/research/collections/[collectionId]/page.tsx
"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useDebouncedCallback } from "use-debounce";
import { CollectionItemCard } from "@/components/research/collection-item-card";
import { CollectionTagFilterRail } from "@/components/research/collection-tag-filter-rail";
import { CollectionSettingsRail } from "@/components/research/collection-settings-rail";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function CollectionDetailPage() {
  const params = useParams<{ collectionId: string }>();
  const collectionId = params?.collectionId as string;

  const { data, isLoading } = trpc.research.collections.get.useQuery({ collectionId });
  const utils = trpc.useUtils();
  const renameMut = trpc.research.collections.rename.useMutation();
  const removeItemMut = trpc.research.collections.removeItem.useMutation();

  const [name, setName] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [selectedTags, setSelectedTags] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (data?.collection) {
      setName(data.collection.name);
      setDesc(data.collection.description ?? "");
    }
  }, [data?.collection?.id]);

  const persistName = useDebouncedCallback(async (next: string) => {
    if (!data) return;
    await renameMut.mutateAsync({ collectionId, name: next.trim() || data.collection.name, description: desc.trim() || undefined });
    await utils.research.collections.get.invalidate({ collectionId });
  }, 1000);

  const persistDesc = useDebouncedCallback(async (next: string) => {
    if (!data) return;
    await renameMut.mutateAsync({ collectionId, name: name.trim() || data.collection.name, description: next.trim() || undefined });
    await utils.research.collections.get.invalidate({ collectionId });
  }, 1000);

  const handleRemoveItem = async (itemId: string) => {
    await removeItemMut.mutateAsync({ itemId });
    await utils.research.collections.get.invalidate({ collectionId });
  };

  const toggleTag = (t: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  if (isLoading || !data) return <div className="p-6">Loading…</div>;

  const isOwner = data.viewerIsOwner ?? false;

  const visibleItems = data.items.filter((i: any) => {
    if (selectedTags.size === 0) return true;
    return Array.from(selectedTags).every((t) => i.tags.includes(t));
  });

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800">
        <CollectionTagFilterRail
          items={data.items}
          selected={selectedTags}
          onToggle={toggleTag}
          onClear={() => setSelectedTags(new Set())}
        />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <header className="mb-6">
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); persistName(e.target.value); }}
            className="border-none px-0 text-xl font-semibold focus-visible:ring-0"
            maxLength={200}
          />
          <Textarea
            value={desc}
            onChange={(e) => { setDesc(e.target.value); persistDesc(e.target.value); }}
            placeholder="Description (optional)"
            className="mt-1 min-h-[40px] resize-none border-none px-0 text-sm text-muted-foreground focus-visible:ring-0"
            maxLength={500}
          />
        </header>
        <p className="mb-3 text-xs text-muted-foreground">
          {visibleItems.length} of {data.itemCount} items
          {selectedTags.size > 0 && ` (filtered by ${Array.from(selectedTags).join(", ")})`}
        </p>
        {visibleItems.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {data.itemCount === 0
              ? 'No items yet. Use "Add to collection" on any opinion, statute, memo, or session.'
              : "No items match the current tag filter."}
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleItems.map((item: any) => (
              <li key={item.id}>
                <CollectionItemCard item={item} onRemove={() => handleRemoveItem(item.id)} />
              </li>
            ))}
          </ul>
        )}
      </main>
      <aside className="hidden w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-800 lg:block">
        <CollectionSettingsRail collection={data.collection} isOwner={isOwner} />
      </aside>
    </div>
  );
}
