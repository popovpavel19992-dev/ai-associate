"use client";

import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ChatPanel } from "./chat-panel";
import { StatuteHeader } from "./statute-header";

interface StatuteViewerProps {
  statuteInternalId?: string;
  citationSlug?: string;
}

export function StatuteViewer({
  statuteInternalId,
  citationSlug,
}: StatuteViewerProps) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  const input = statuteInternalId
    ? ({ internalId: statuteInternalId } as const)
    : ({ citationSlug: citationSlug ?? "" } as const);
  const query = trpc.research.statutes.get.useQuery(input, {
    enabled: Boolean(statuteInternalId) || Boolean(citationSlug),
  });

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Statute not found.
      </div>
    );
  }

  const statute = query.data;
  const effectiveDateIso =
    statute.effectiveDate === null || statute.effectiveDate === undefined
      ? null
      : typeof statute.effectiveDate === "string"
        ? statute.effectiveDate
        : new Date(statute.effectiveDate as unknown as string).toISOString();

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <StatuteHeader
          statute={{
            id: statute.id,
            source: statute.source,
            title: statute.title,
            section: statute.section,
            citationBluebook: statute.citationBluebook,
            heading: statute.heading,
            effectiveDate: effectiveDateIso,
          }}
        />
        <div className="flex-1 overflow-y-auto p-6">
          <article className="prose dark:prose-invert max-w-none whitespace-pre-wrap font-serif text-base leading-7">
            {statute.bodyText ||
              "Full text not yet loaded. Try reloading in a moment."}
          </article>
          <div className="mt-8 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            This statutory text is provided for research purposes. ClearTerms
            Research offers case-law analysis, not legal advice.
          </div>
        </div>
      </div>
      {sessionId ? (
        <aside className="hidden w-96 shrink-0 border-l border-zinc-200 dark:border-zinc-800 lg:flex lg:flex-col">
          <ChatPanel
            sessionId={sessionId}
            mode="deep"
            statuteInternalId={statute.id}
          />
        </aside>
      ) : null}
    </div>
  );
}
