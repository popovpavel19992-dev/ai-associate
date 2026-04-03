"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AVAILABLE_SECTIONS, SECTION_LABELS, CASE_TYPES } from "@/lib/constants";
import { CaseTypeSelector } from "./case-type-selector";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { DocumentList } from "@/components/documents/document-list";

const DEFAULT_SECTIONS = [
  "timeline",
  "key_facts",
  "parties",
  "legal_arguments",
  "risk_assessment",
];

export function CreateCaseForm() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [caseType, setCaseType] = useState<string | null>("auto");
  const [selectedSections, setSelectedSections] =
    useState<string[]>(DEFAULT_SECTIONS);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "upload">("details");

  const createCase = trpc.cases.create.useMutation({
    onSuccess: (data) => {
      setCaseId(data.id);
      setStep("upload");
    },
  });

  const analyze = trpc.cases.analyze.useMutation({
    onSuccess: () => {
      if (caseId) {
        router.push(`/cases/${caseId}`);
      }
    },
  });

  const docsQuery = trpc.documents.listByCase.useQuery(
    { caseId: caseId! },
    { enabled: !!caseId, refetchInterval: 3000 },
  );

  const deleteDoc = trpc.documents.delete.useMutation({
    onSuccess: () => {
      utils.documents.listByCase.invalidate({ caseId: caseId! });
    },
  });

  const toggleSection = useCallback((section: string) => {
    setSelectedSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section],
    );
  }, []);

  const handleCreateCase = () => {
    if (!name.trim()) return;
    createCase.mutate({
      name: name.trim(),
      caseType: caseType === "auto" ? undefined : (caseType as (typeof CASE_TYPES)[number]),
      selectedSections,
    });
  };

  const handleAnalyze = () => {
    if (!caseId) return;
    analyze.mutate({ caseId });
  };

  const docs = docsQuery.data ?? [];
  const hasDocuments = docs.length > 0;

  if (step === "details") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New Case</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="case-name">Case Name</Label>
            <Input
              id="case-name"
              placeholder="e.g. Smith v. Johnson — Motor Vehicle Accident"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>Case Type</Label>
            <CaseTypeSelector value={caseType} onChange={setCaseType} />
            <p className="text-xs text-muted-foreground">
              Auto-detect analyzes uploaded documents to determine the case type.
            </p>
          </div>

          <div className="space-y-3">
            <Label>Analysis Sections</Label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_SECTIONS.map((section) => (
                <label
                  key={section}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <input
                    type="checkbox"
                    checked={selectedSections.includes(section)}
                    onChange={() => toggleSection(section)}
                    className="rounded border-zinc-300"
                  />
                  {SECTION_LABELS[section] ?? section}
                </label>
              ))}
            </div>
          </div>

          <Button
            onClick={handleCreateCase}
            disabled={!name.trim() || selectedSections.length === 0 || createCase.isPending}
            className="w-full"
          >
            {createCase.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Continue to Upload
          </Button>

          {createCase.error && (
            <p className="text-sm text-red-500">{createCase.error.message}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <UploadDropzone
          caseId={caseId!}
          onUploadComplete={() => {
            utils.documents.listByCase.invalidate({ caseId: caseId! });
          }}
        />

        {docs.length > 0 && (
          <DocumentList
            documents={docs}
            onRemove={(docId) => deleteDoc.mutate({ documentId: docId })}
            isRemoving={deleteDoc.isPending}
          />
        )}

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setStep("details")}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            onClick={handleAnalyze}
            disabled={!hasDocuments || analyze.isPending}
            className="flex-1"
          >
            {analyze.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Analyze ({docs.length} {docs.length === 1 ? "document" : "documents"})
          </Button>
        </div>

        {analyze.error && (
          <p className="text-sm text-red-500">{analyze.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
