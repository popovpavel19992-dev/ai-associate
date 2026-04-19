// src/components/research/collection-tag-editor.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";

interface CollectionTagEditorProps {
  itemId: string;
  initialTags: string[];
}

export function CollectionTagEditor({ itemId, initialTags }: CollectionTagEditorProps) {
  const [tags, setTags] = React.useState<string[]>(initialTags);
  const [input, setInput] = React.useState("");
  const updateMut = trpc.research.collections.updateItem.useMutation();

  React.useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  const persist = async (next: string[]) => {
    setTags(next);
    await updateMut.mutateAsync({ itemId, tags: next });
  };

  const commitInput = async () => {
    const norm = input.trim().toLowerCase();
    if (!norm || norm.length > 50 || tags.includes(norm)) {
      setInput("");
      return;
    }
    const next = [...tags, norm];
    setInput("");
    await persist(next);
  };

  const remove = async (t: string) => {
    await persist(tags.filter((x) => x !== t));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full border bg-zinc-50 px-2 py-0.5 text-xs dark:bg-zinc-900"
        >
          {t}
          <button type="button" onClick={() => remove(t)} aria-label={`Remove tag ${t}`}>
            <X className="size-3 text-muted-foreground hover:text-red-600" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitInput();
          }
        }}
        onBlur={commitInput}
        placeholder="+ tag"
        maxLength={50}
        className="w-20 border-none bg-transparent text-xs outline-none placeholder:text-muted-foreground focus:w-32"
      />
    </div>
  );
}
