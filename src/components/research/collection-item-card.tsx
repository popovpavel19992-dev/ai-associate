// src/components/research/collection-item-card.tsx
"use client";

import Link from "next/link";
import { FileText, Scale, BookOpen, Search } from "lucide-react";
import { CollectionTagEditor } from "./collection-tag-editor";

interface CollectionItemCardProps {
  item: {
    id: string;
    itemType: "opinion" | "statute" | "memo" | "session";
    opinionId: string | null;
    statuteId: string | null;
    memoId: string | null;
    sessionId: string | null;
    notes: string | null;
    tags: string[];
  };
  artifact?: {
    title: string;
    citation?: string;
    snippet?: string;
    href: string;
  };
  onRemove?: () => void;
}

const ICON: Record<string, typeof FileText> = {
  opinion: Scale,
  statute: BookOpen,
  memo: FileText,
  session: Search,
};

export function CollectionItemCard({ item, artifact, onRemove }: CollectionItemCardProps) {
  const Icon = ICON[item.itemType];
  const fallbackTitle = item.itemType === "opinion" ? "Opinion"
    : item.itemType === "statute" ? "Statute"
    : item.itemType === "memo" ? "Memo"
    : "Session";
  return (
    <article className="rounded-md border p-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href={artifact?.href ?? "#"} className="flex items-center gap-2 text-sm font-medium hover:underline">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{artifact?.title ?? fallbackTitle}</span>
          </Link>
          {artifact?.citation && (
            <p className="mt-0.5 text-xs text-muted-foreground">{artifact.citation}</p>
          )}
          {artifact?.snippet && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{artifact.snippet}</p>
          )}
          {item.notes && (
            <p className="mt-2 text-xs italic text-muted-foreground">"{item.notes}"</p>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 text-xs text-muted-foreground hover:text-red-600"
            aria-label="Remove from collection"
          >
            Remove
          </button>
        )}
      </header>
      <div className="mt-2">
        <CollectionTagEditor itemId={item.id} initialTags={item.tags} />
      </div>
    </article>
  );
}
