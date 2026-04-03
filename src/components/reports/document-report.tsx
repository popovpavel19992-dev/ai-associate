"use client";

import { FileText } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SectionRenderer } from "./section-renderer";
import { SECTION_LABELS } from "@/lib/constants";
import type { AnalysisOutput } from "@/lib/schemas";

interface DocumentReportProps {
  filename: string;
  sections: AnalysisOutput;
  userEdits?: Record<string, unknown>;
  selectedSections?: string[];
}

export function DocumentReport({
  filename,
  sections,
  userEdits,
  selectedSections,
}: DocumentReportProps) {
  const sectionKeys = (
    selectedSections ?? Object.keys(sections)
  ).filter((key) => key in sections) as (keyof AnalysisOutput)[];

  if (sectionKeys.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No analysis sections available for this document.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{filename}</h2>
      </div>

      {sectionKeys.map((key, i) => (
        <div key={key}>
          <SectionRenderer
            sectionName={key}
            data={sections[key]}
            userEdits={userEdits?.[key]}
          />
          {i < sectionKeys.length - 1 && <Separator className="mt-6" />}
        </div>
      ))}
    </div>
  );
}
