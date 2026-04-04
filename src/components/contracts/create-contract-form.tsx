"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABELS,
  CONTRACT_ANALYSIS_SECTIONS,
  CONTRACT_SECTION_LABELS,
  MAX_FILE_SIZE,
} from "@/lib/constants";

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

type UploadStep = "idle" | "hashing" | "presigning" | "uploading" | "creating" | "analyzing";

export function CreateContractForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [contractType, setContractType] = useState<string>("auto");
  const [linkedCaseId, setLinkedCaseId] = useState<string>("");
  const [selectedSections, setSelectedSections] = useState<string[]>([
    ...CONTRACT_ANALYSIS_SECTIONS,
  ]);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadStep, setUploadStep] = useState<UploadStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const casesQuery = trpc.cases.list.useQuery(
    { limit: 100, offset: 0 },
    { staleTime: 60_000 },
  );

  const createContract = trpc.contracts.create.useMutation();
  const analyzeContract = trpc.contracts.analyze.useMutation();

  const toggleSection = useCallback((section: string) => {
    setSelectedSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section],
    );
  }, []);

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("File exceeds 25MB limit");
      return;
    }
    setFile(selectedFile);
    setError(null);
    if (!name.trim()) {
      const baseName = selectedFile.name.replace(/\.[^.]+$/, "");
      setName(baseName);
    }
  }, [name]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFileSelect(droppedFile);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) handleFileSelect(selected);
    },
    [handleFileSelect],
  );

  const removeFile = useCallback(() => {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const isSubmitting = uploadStep !== "idle";

  const handleSubmit = async () => {
    if (!file || !name.trim() || selectedSections.length === 0) return;

    setError(null);

    try {
      // 1. Hash file
      setUploadStep("hashing");
      const checksum = await computeSha256(file);

      // 2. Get presigned URL
      setUploadStep("presigning");
      const presignRes = await fetch("/api/upload/presign-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json();
        throw new Error(err.error ?? "Failed to get upload URL");
      }

      const { uploadUrl, s3Key, fileType } = await presignRes.json();

      // 3. Upload to S3
      setUploadStep("uploading");
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload file to storage");
      }

      // 4. Create contract record
      setUploadStep("creating");
      const contract = await createContract.mutateAsync({
        name: name.trim(),
        s3Key,
        filename: file.name,
        fileType,
        fileSize: file.size,
        checksum,
        contractType:
          contractType === "auto"
            ? undefined
            : (contractType as (typeof CONTRACT_TYPES)[number]),
        linkedCaseId: linkedCaseId || undefined,
        selectedSections,
      });

      // 5. Start analysis
      setUploadStep("analyzing");
      await analyzeContract.mutateAsync({ contractId: contract.id });

      toast.success("Contract submitted for review");
      router.push(`/contracts/${contract.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setUploadStep("idle");
    }
  };

  const stepLabel: Record<UploadStep, string> = {
    idle: "Submit for Review",
    hashing: "Computing checksum...",
    presigning: "Preparing upload...",
    uploading: "Uploading file...",
    creating: "Creating contract...",
    analyzing: "Starting analysis...",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Contract Review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Contract Name */}
        <div className="space-y-2">
          <Label htmlFor="contract-name">Contract Name</Label>
          <Input
            id="contract-name"
            placeholder="e.g. Acme Corp — Service Agreement"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            disabled={isSubmitting}
          />
        </div>

        {/* File Upload */}
        <div className="space-y-2">
          <Label>Upload Contract</Label>
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={removeFile}
                disabled={isSubmitting}
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Drop your contract here, or click to browse
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, DOCX, or TXT up to 25MB
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.rtf"
            onChange={handleInputChange}
            className="hidden"
          />
        </div>

        {/* Contract Type */}
        <div className="space-y-2">
          <Label htmlFor="contract-type">Contract Type</Label>
          <select
            id="contract-type"
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
            disabled={isSubmitting}
            className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800"
          >
            <option value="auto">Auto-detect</option>
            {CONTRACT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONTRACT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Auto-detect analyzes the document to determine the contract type.
          </p>
        </div>

        {/* Link to Case (optional) */}
        <div className="space-y-2">
          <Label htmlFor="linked-case">Link to Case (optional)</Label>
          <select
            id="linked-case"
            value={linkedCaseId}
            onChange={(e) => setLinkedCaseId(e.target.value)}
            disabled={isSubmitting}
            className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800"
          >
            <option value="">None</option>
            {casesQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Analysis Sections */}
        <div className="space-y-3">
          <Label>Analysis Sections</Label>
          <div className="grid grid-cols-2 gap-2">
            {CONTRACT_ANALYSIS_SECTIONS.map((section) => (
              <label
                key={section}
                className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <input
                  type="checkbox"
                  checked={selectedSections.includes(section)}
                  onChange={() => toggleSection(section)}
                  disabled={isSubmitting}
                  className="rounded border-zinc-300"
                />
                {CONTRACT_SECTION_LABELS[section] ?? section}
              </label>
            ))}
          </div>
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={
            !name.trim() ||
            !file ||
            selectedSections.length === 0 ||
            isSubmitting
          }
          className="w-full"
        >
          {isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {stepLabel[uploadStep]}
        </Button>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
