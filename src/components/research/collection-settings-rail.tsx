// src/components/research/collection-settings-rail.tsx
"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

interface CollectionSettingsRailProps {
  collection: {
    id: string;
    name: string;
    sharedWithOrg: boolean;
    caseId: string | null;
  };
  isOwner: boolean;
}

export function CollectionSettingsRail({ collection, isOwner }: CollectionSettingsRailProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const setShareMut = trpc.research.collections.setShare.useMutation();
  const setCaseMut = trpc.research.collections.setCase.useMutation();
  const deleteMut = trpc.research.collections.delete.useMutation();

  const toggleShare = async () => {
    await setShareMut.mutateAsync({ collectionId: collection.id, shared: !collection.sharedWithOrg });
    await utils.research.collections.get.invalidate({ collectionId: collection.id });
  };

  const clearCase = async () => {
    await setCaseMut.mutateAsync({ collectionId: collection.id, caseId: null });
    await utils.research.collections.get.invalidate({ collectionId: collection.id });
  };

  const remove = async () => {
    if (!window.confirm(`Delete collection "${collection.name}"?`)) return;
    await deleteMut.mutateAsync({ collectionId: collection.id });
    router.push("/research/collections");
  };

  if (!isOwner) {
    return (
      <div className="space-y-2 p-4 text-sm text-muted-foreground">
        <p>Read-only view (shared by another team member).</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Sharing</h3>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={collection.sharedWithOrg} onChange={toggleShare} />
          Share with org (view-only)
        </label>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Case</h3>
        {collection.caseId ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Linked</span>
            <Button variant="ghost" size="sm" onClick={clearCase}>Unlink</Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Not linked. (Link from a case page.)</p>
        )}
      </section>
      <section className="border-t pt-4">
        <Button variant="destructive" size="sm" onClick={remove}>Delete collection</Button>
      </section>
    </div>
  );
}
