"use client";

import { useState } from "react";
import { FileText, Briefcase, Loader2, AlertTriangle } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CASE_TYPE_LABELS } from "@/lib/constants";
import { ChatPanel } from "@/components/chat/chat-panel";
import { CaseBrief } from "./case-brief";
import { DocumentReport } from "./document-report";
import { ExportMenu } from "./export-menu";
import type { AnalysisOutput } from "@/lib/schemas";

interface DocumentData {
  id: string;
  filename: string;
  status: string;
}

interface AnalysisData {
  documentId: string;
  sections: unknown;
  userEdits?: Record<string, unknown> | null;
}

interface ReportViewProps {
  caseId: string;
  caseName: string;
  caseType: string;
  status: string;
  caseBrief: unknown;
  documents: DocumentData[];
  analyses: AnalysisData[];
  selectedSections?: string[] | null;
  onReanalyze?: () => void;
  isReanalyzing?: boolean;
}

type ActiveView =
  | { type: "brief" }
  | { type: "document"; documentId: string };

export function ReportView({
  caseId,
  caseName,
  caseType,
  status,
  caseBrief,
  documents,
  analyses,
  selectedSections,
  onReanalyze,
  isReanalyzing,
}: ReportViewProps) {
  const [activeView, setActiveView] = useState<ActiveView>({ type: "brief" });

  const activeDocumentId =
    activeView.type === "document" ? activeView.documentId : undefined;
  const activeDocName = activeDocumentId
    ? documents.find((d) => d.id === activeDocumentId)?.filename
    : undefined;

  // Processing state
  if (status === "processing") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium">Analyzing your documents...</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This may take a few minutes depending on document length.
          </p>
        </div>
      </div>
    );
  }

  // Failed state
  if (status === "failed") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12">
        <AlertTriangle className="size-8 text-destructive" />
        <div className="text-center">
          <p className="font-medium">Analysis failed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Something went wrong during analysis. Please try again.
          </p>
        </div>
        {onReanalyze && (
          <Button onClick={onReanalyze} disabled={isReanalyzing}>
            {isReanalyzing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Retry Analysis
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel: report content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{caseName}</h1>
            {caseType && caseType !== "general" && (
              <Badge variant="secondary">
                {CASE_TYPE_LABELS[caseType] ?? caseType}
              </Badge>
            )}
            <Badge variant="outline">
              {documents.length} doc{documents.length !== 1 ? "s" : ""}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {status === "ready" && (
              <ExportMenu caseId={caseId} caseName={caseName} />
            )}
            {onReanalyze && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReanalyze}
                disabled={isReanalyzing}
              >
                {isReanalyzing ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
                Re-analyze
              </Button>
            )}
          </div>
        </div>

        {/* Tabs + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar nav */}
          <div className="w-56 shrink-0 overflow-y-auto border-r bg-muted/30 p-3">
            <button
              onClick={() => setActiveView({ type: "brief" })}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                activeView.type === "brief"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-background/50"
              }`}
            >
              <Briefcase className="size-3.5" />
              Case Brief
            </button>

            <Separator className="my-2" />

            <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">
              Documents ({documents.length})
            </p>
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setActiveView({ type: "document", documentId: doc.id })}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  activeView.type === "document" && activeView.documentId === doc.id
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-background/50"
                }`}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{doc.filename}</span>
              </button>
            ))}
          </div>

          {/* Content area */}
          <ScrollArea className="flex-1">
            <div className="p-6">
              {activeView.type === "brief" ? (
                caseBrief ? (
                  <CaseBrief
                    brief={caseBrief as AnalysisOutput}
                    documentCount={documents.length}
                  />
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {documents.length <= 1
                      ? "Case brief is generated when analyzing 2+ documents."
                      : "Case brief has not been generated yet."}
                  </div>
                )
              ) : (
                (() => {
                  const doc = documents.find(
                    (d) => d.id === activeView.documentId,
                  );
                  const analysis = analyses.find(
                    (a) => a.documentId === activeView.documentId,
                  );
                  if (!doc) return null;
                  if (!analysis) {
                    return (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        No analysis available for this document.
                      </div>
                    );
                  }
                  return (
                    <DocumentReport
                      filename={doc.filename}
                      sections={analysis.sections as AnalysisOutput}
                      userEdits={analysis.userEdits ?? undefined}
                      selectedSections={selectedSections ?? undefined}
                    />
                  );
                })()
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Right panel: chat */}
      <ChatPanel
        caseId={caseId}
        documentId={activeDocumentId}
        documentName={activeDocName}
      />
    </div>
  );
}
