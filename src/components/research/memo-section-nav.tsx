// src/components/research/memo-section-nav.tsx
"use client";

import { cn } from "@/lib/utils";
import { Pencil, Sparkles } from "lucide-react";

const LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

interface MemoSectionNavProps {
  memo: { id: string; title: string };
  sections: Array<{
    sectionType: "issue" | "rule" | "application" | "conclusion";
    aiGeneratedAt: string | Date | null;
    userEditedAt: string | Date | null;
  }>;
  active: string;
  onSelect: (s: "issue" | "rule" | "application" | "conclusion") => void;
}

export function MemoSectionNav({ memo, sections, active, onSelect }: MemoSectionNavProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-medium">{memo.title}</h2>
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        {sections.map((s) => {
          const isActive = s.sectionType === active;
          const edited =
            s.userEditedAt &&
            (!s.aiGeneratedAt || new Date(s.userEditedAt) > new Date(s.aiGeneratedAt));
          return (
            <li key={s.sectionType}>
              <button
                type="button"
                onClick={() => onSelect(s.sectionType)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900",
                  isActive && "bg-zinc-100 font-medium dark:bg-zinc-900",
                )}
                aria-current={isActive ? "true" : "false"}
              >
                <span>{LABEL[s.sectionType]}</span>
                {edited ? (
                  <Pencil className="size-3 text-muted-foreground" aria-label="User-edited" />
                ) : (
                  <Sparkles className="size-3 text-muted-foreground" aria-label="AI-generated" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
