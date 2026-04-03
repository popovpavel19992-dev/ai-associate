"use client";

import { Briefcase, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SectionRenderer } from "./section-renderer";
import type { AnalysisOutput } from "@/lib/schemas";

interface CaseBriefProps {
  brief: AnalysisOutput;
  documentCount: number;
}

export function CaseBrief({ brief, documentCount }: CaseBriefProps) {
  const sectionKeys = Object.keys(brief).filter(
    (key) => brief[key as keyof AnalysisOutput] != null,
  ) as (keyof AnalysisOutput)[];

  if (sectionKeys.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Case brief has not been generated yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Briefcase className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Case Brief</h2>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Synthesized from {documentCount} document{documentCount !== 1 ? "s" : ""}.
          Cross-referenced information is highlighted where analyses from different
          documents provide corroborating or conflicting data.
        </p>
      </div>

      {sectionKeys.map((key, i) => (
        <div key={key}>
          <SectionRenderer sectionName={key} data={brief[key]} />
          {i < sectionKeys.length - 1 && <Separator className="mt-6" />}
        </div>
      ))}
    </div>
  );
}
