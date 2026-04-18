"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { citationToUrl } from "./citation-to-url";

interface CitationChipProps {
  citation: string;
  unverified?: boolean;
  onClick?: () => void;
}

export function CitationChip({
  citation,
  unverified = false,
  onClick,
}: CitationChipProps) {
  const source = /U\.S\.C\./i.test(citation)
    ? "USC"
    : /C\.?F\.?R\./i.test(citation)
      ? "CFR"
      : null;
  const href = unverified ? null : citationToUrl(citation);

  const className = cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs transition-colors",
    unverified
      ? "border-yellow-400 bg-yellow-50 text-yellow-900 hover:bg-yellow-100 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200"
      : "border-zinc-300 bg-transparent text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
  );

  const title = unverified
    ? "This citation wasn't found in the searched opinions"
    : citation;

  const content = (
    <>
      {unverified ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : null}
      {source ? <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">{source}</span> : null}
      <span className="truncate">{citation}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} title={title} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} title={title} className={className}>
      {content}
    </button>
  );
}
