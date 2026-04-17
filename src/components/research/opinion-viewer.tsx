"use client";

import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { OpinionHeader } from "./opinion-header";

interface OpinionViewerProps {
  opinionInternalId: string;
}

// Matches lines that begin with a section marker (Syllabus, Dissent,
// Concurrence). Used to split the body into collapsible <details> regions.
// TODO(2.2.1): Real structure detection would require parsing CourtListener's
// HTML; the naive regex approach is documented as best-effort only.
const SECTION_REGEX = /^(syllabus|dissent|concurrence)\b.*$/i;

interface Section {
  heading: string | null;
  body: string[];
}

function splitSections(fullText: string): Section[] {
  const paragraphs = fullText.split(/\n\n+/).map((p) => p.trim());
  const sections: Section[] = [];
  let current: Section = { heading: null, body: [] };

  for (const para of paragraphs) {
    if (!para) continue;
    const firstLine = para.split("\n")[0]?.trim() ?? "";
    if (SECTION_REGEX.test(firstLine)) {
      if (current.heading !== null || current.body.length > 0) {
        sections.push(current);
      }
      current = { heading: firstLine, body: [] };
      const rest = para.slice(firstLine.length).trim();
      if (rest) current.body.push(rest);
    } else {
      current.body.push(para);
    }
  }
  if (current.heading !== null || current.body.length > 0) {
    sections.push(current);
  }
  return sections;
}

function NumberedParagraphs({
  paragraphs,
  startIndex,
}: {
  paragraphs: string[];
  startIndex: number;
}) {
  return (
    <>
      {paragraphs.map((p, i) => {
        const n = startIndex + i + 1;
        return (
          <div key={n} className="flex gap-4 py-1">
            <span
              aria-hidden="true"
              className="w-8 shrink-0 pt-1 text-right text-xs text-zinc-400 dark:text-zinc-600"
            >
              {n}
            </span>
            <p className="flex-1">{p}</p>
          </div>
        );
      })}
    </>
  );
}

function OpinionBody({ fullText }: { fullText: string }) {
  const sections = splitSections(fullText);
  let runningIndex = 0;
  return (
    <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap font-serif text-base leading-7">
      {sections.map((section, idx) => {
        const bodyStart = runningIndex;
        runningIndex += section.body.length;
        if (section.heading === null) {
          return (
            <NumberedParagraphs
              key={`plain-${idx}`}
              paragraphs={section.body}
              startIndex={bodyStart}
            />
          );
        }
        return (
          <details
            key={`section-${idx}`}
            open
            className="my-4 rounded-md border border-zinc-200 dark:border-zinc-800"
          >
            <summary className="cursor-pointer select-none px-3 py-2 font-sans text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {section.heading}
            </summary>
            <div className="px-3 pb-3">
              <NumberedParagraphs
                paragraphs={section.body}
                startIndex={bodyStart}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-6 animate-pulse rounded bg-muted"
          style={{ width: `${60 + ((i * 13) % 40)}%` }}
        />
      ))}
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-medium">Opinion not found</p>
      <Link
        href="/research"
        className="text-sm text-primary underline underline-offset-4"
      >
        Back to research
      </Link>
    </div>
  );
}

export function OpinionViewer({ opinionInternalId }: OpinionViewerProps) {
  const { data, isLoading, isError } = trpc.research.getOpinion.useQuery(
    { opinionInternalId },
    { enabled: !!opinionInternalId },
  );

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <LoadingSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full flex-col">
        <NotFound />
      </div>
    );
  }

  const fullText = data.fullText ?? "";

  return (
    <div className="flex h-full flex-col">
      <OpinionHeader
        opinion={{
          id: data.id,
          caseName: data.caseName,
          citationBluebook: data.citationBluebook,
          court: data.court,
          decisionDate:
            typeof data.decisionDate === "string"
              ? data.decisionDate
              : new Date(data.decisionDate as unknown as string).toISOString(),
          jurisdiction: data.jurisdiction,
          courtLevel: data.courtLevel,
          metadata: data.metadata as OpinionHeaderMetadata,
        }}
      />
      <Separator />
      <div className="flex-1 overflow-y-auto p-6">
        {fullText.trim().length > 0 ? (
          <OpinionBody fullText={fullText} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Full text not yet loaded. Try reloading in a moment.
          </p>
        )}
        <div className="mt-8 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          This opinion is provided for research purposes. ClearTerms Research
          offers case-law analysis, not legal advice.
        </div>
      </div>
    </div>
  );
}

type OpinionHeaderMetadata =
  | {
      judges?: string[];
      syllabusUrl?: string;
      citedByCount?: number;
    }
  | null;
