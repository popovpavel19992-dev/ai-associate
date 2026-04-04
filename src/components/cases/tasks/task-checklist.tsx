"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/server/db/schema/case-tasks";

interface Props {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

export function TaskChecklist({ items, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const doneCount = items.filter((i) => i.completed).length;

  function toggle(id: string) {
    onChange(items.map((i) => (i.id === id ? { ...i, completed: !i.completed } : i)));
  }

  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id));
  }

  function add() {
    if (!newTitle.trim()) return;
    onChange([
      ...items,
      { id: crypto.randomUUID(), title: newTitle.trim(), completed: false },
    ]);
    setNewTitle("");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">
          Checklist <span className="text-zinc-700">{doneCount}/{items.length}</span>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 p-1.5 bg-zinc-900 rounded group">
            <button
              onClick={() => toggle(item.id)}
              className={cn(
                "w-4 h-4 rounded border flex items-center justify-center text-[10px]",
                item.completed ? "bg-blue-600 border-blue-600 text-white" : "border-zinc-700",
              )}
            >
              {item.completed && "✓"}
            </button>
            <span
              className={cn(
                "text-xs flex-1 text-zinc-200",
                item.completed && "line-through text-zinc-500",
              )}
            >
              {item.title}
            </span>
            <button
              onClick={() => remove(item.id)}
              className="text-xs text-zinc-600 opacity-0 group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add item..."
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-700"
          />
          <button onClick={add} className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300">
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}
