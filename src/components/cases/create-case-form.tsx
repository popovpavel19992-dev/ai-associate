"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AVAILABLE_SECTIONS, SECTION_LABELS, CASE_TYPES, CASE_JURISDICTIONS, JURISDICTION_LABELS, type CaseJurisdiction } from "@/lib/constants";
import { CaseTypeSelector } from "./case-type-selector";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { DocumentList } from "@/components/documents/document-list";
import { ClientPicker } from "@/components/clients/client-picker";

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
  const [opposingParty, setOpposingParty] = useState("");
  const [opposingCounsel, setOpposingCounsel] = useState("");
  const [jurisdiction, setJurisdiction] = useState<CaseJurisdiction>("FEDERAL");

  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("clientId");
  const [client, setClient] = useState<{ id: string; displayName: string; clientType: "individual" | "organization" } | null>(null);

  const preselectedQuery = trpc.clients.getById.useQuery(
    { id: preselectedId! },
    { enabled: !!preselectedId && !client },
  );
  // Intentional: sync one-shot state from query result. The `!client` guard
  // prevents cascading renders; `client` is excluded from deps so subsequent
  // user picks aren't overwritten if the preselected query later refetches.
  useEffect(() => {
    if (preselectedQuery.data && !client) {
      const c = preselectedQuery.data.client;
      setClient({ id: c.id, displayName: c.displayName, clientType: c.clientType });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedQuery.data]);

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
    if (!name.trim() || !client) return;
    createCase.mutate({
      clientId: client.id,
      name: name.trim(),
      caseType: caseType === "auto" ? undefined : (caseType as (typeof CASE_TYPES)[number]),
      selectedSections,
      opposingParty: opposingParty.trim() || undefined,
      opposingCounsel: opposingCounsel.trim() || undefined,
      jurisdiction,
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
            <Label>Client</Label>
            <ClientPicker value={client} onChange={setClient} />
          </div>

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

          <div className="space-y-2">
            <Label htmlFor="jurisdiction">Jurisdiction</Label>
            <select
              id="jurisdiction"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value as CaseJurisdiction)}
              className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:focus-visible:ring-zinc-300"
            >
              {CASE_JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {JURISDICTION_LABELS[j] ?? j}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Deadlines and court rules will use this jurisdiction&apos;s defaults. FRCP fallback applies when a state-specific rule is absent.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="opposing-party">Opposing Party</Label>
              <Input
                id="opposing-party"
                placeholder="Name of opposing party"
                value={opposingParty}
                onChange={(e) => setOpposingParty(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opposing-counsel">Opposing Counsel</Label>
              <Input
                id="opposing-counsel"
                placeholder="Name of opposing counsel"
                value={opposingCounsel}
                onChange={(e) => setOpposingCounsel(e.target.value)}
                maxLength={200}
              />
            </div>
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
            disabled={!client || !name.trim() || selectedSections.length === 0 || createCase.isPending}
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
