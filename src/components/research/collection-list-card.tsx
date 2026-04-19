// src/components/research/collection-list-card.tsx
"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Library, Share2 } from "lucide-react";

interface CollectionListCardProps {
  collection: {
    id: string;
    name: string;
    description: string | null;
    sharedWithOrg: boolean;
    caseId: string | null;
    updatedAt: string | Date;
  };
  itemCount?: number;
}

export function CollectionListCard({ collection, itemCount }: CollectionListCardProps) {
  const updated = typeof collection.updatedAt === "string" ? new Date(collection.updatedAt) : collection.updatedAt;
  return (
    <Link
      href={`/research/collections/${collection.id}`}
      className="block rounded-md border p-4 transition hover:border-primary"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 truncate text-sm font-medium">
            <Library className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {collection.name}
          </h3>
          {collection.description && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{collection.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {itemCount !== undefined ? `${itemCount} items · ` : ""}
            Updated {formatDistanceToNow(updated, { addSuffix: true })}
            {collection.caseId ? " · case-linked" : ""}
          </p>
        </div>
        {collection.sharedWithOrg && (
          <Share2 className="size-4 shrink-0 text-emerald-500" aria-label="Shared with org" />
        )}
      </div>
    </Link>
  );
}
