"use client";

import * as React from "react";
import Link from "next/link";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RuleCardData {
  id: string;
  jurisdiction: string;
  ruleNumber: string;
  title: string;
  body: string;
  category: string;
  citationShort: string;
  isBookmarked: boolean;
}

interface Props {
  rule: RuleCardData;
  onToggleBookmark: (rule: RuleCardData) => void;
  pendingBookmark?: boolean;
}

export function RuleCard({ rule, onToggleBookmark, pendingBookmark }: Props) {
  const preview = rule.body.length > 180 ? rule.body.slice(0, 180).trimEnd() + "…" : rule.body;
  return (
    <div className="group relative rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary" className="font-mono">
              {rule.jurisdiction}
            </Badge>
            <Badge variant="outline">{rule.category}</Badge>
            <span className="font-mono text-zinc-500">{rule.citationShort}</span>
          </div>
          <Link href={`/rules/${rule.id}`} className="block">
            <h3 className="mt-2 truncate text-base font-semibold text-zinc-900 group-hover:underline dark:text-zinc-100">
              {rule.title}
            </h3>
          </Link>
          <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{preview}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={rule.isBookmarked ? "Remove bookmark" : "Add bookmark"}
          aria-pressed={rule.isBookmarked}
          disabled={pendingBookmark}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleBookmark(rule);
          }}
        >
          <Star
            className={cn(
              "h-5 w-5 transition-colors",
              rule.isBookmarked
                ? "fill-amber-400 text-amber-500"
                : "text-zinc-400 hover:text-amber-500",
            )}
          />
        </Button>
      </div>
    </div>
  );
}
