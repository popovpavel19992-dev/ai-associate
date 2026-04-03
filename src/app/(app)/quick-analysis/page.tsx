"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { UploadDropzone } from "@/components/documents/upload-dropzone";

export default function QuickAnalysisPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"idle" | "creating" | "uploading" | "analyzing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);

  const createCase = trpc.cases.create.useMutation();
  const analyze = trpc.cases.analyze.useMutation();

  const handleUploadComplete = useCallback(async () => {
    if (!caseId) return;

    try {
      setStatus("analyzing");
      await analyze.mutateAsync({ caseId });
      router.push(`/cases/${caseId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStatus("idle");
    }
  }, [caseId, analyze, router]);

  const handleFileDrop = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setError(null);

      try {
        // Auto-create case
        setStatus("creating");
        const file = files[0];
        const caseName = file.name.replace(/\.[^.]+$/, "");
        const created = await createCase.mutateAsync({ name: caseName });
        setCaseId(created.id);
        setStatus("uploading");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create case");
        setStatus("idle");
      }
    },
    [createCase],
  );

  // If we have a caseId, show the upload dropzone (auto-created case)
  if (caseId && status === "uploading") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Quick Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <UploadDropzone
              caseId={caseId}
              onUploadComplete={handleUploadComplete}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === "creating" || status === "analyzing") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {status === "creating"
                ? "Setting up your case..."
                : "Starting analysis..."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Quick Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload a single document for instant AI analysis. A case will be
            auto-created and analysis starts immediately.
          </p>

          <QuickDropzone onFiles={handleFileDrop} />

          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function QuickDropzone({
  onFiles,
}: {
  onFiles: (files: FileList | null) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onFiles(e.dataTransfer.files);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragOver(false);
      }}
      onClick={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
        input.onchange = () => onFiles(input.files);
        input.click();
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 transition-colors ${
        isDragOver
          ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900"
          : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
      }`}
    >
      <Zap className="mb-3 h-8 w-8 text-zinc-400" />
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {isDragOver ? "Drop file here" : "Drop a document for instant analysis"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        PDF, DOCX, JPEG, PNG — max 25MB
      </p>
    </div>
  );
}
