"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, GitCompareArrows, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type Stage = "idle" | "hashing" | "uploading" | "creating" | "comparing" | "error";

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadFileToS3(file: File): Promise<{
  s3Key: string;
  fileType: string;
  checksum: string;
}> {
  // 1. Compute SHA-256 hash
  const checksum = await computeSha256(file);

  // 2. Get presigned URL
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
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error("Failed to upload file to storage");
  }

  return { s3Key, fileType, checksum };
}

export default function DirectComparePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);

  const createContract = trpc.contracts.create.useMutation();
  const createComparison = trpc.comparisons.create.useMutation();

  const handleDrop = useCallback(
    (side: "a" | "b") => (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        if (side === "a") setFileA(file);
        else setFileB(file);
      }
    },
    [],
  );

  const handleClick = useCallback(
    (side: "a" | "b") => () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) {
          if (side === "a") setFileA(file);
          else setFileB(file);
        }
      };
      input.click();
    },
    [],
  );

  const handleCompare = useCallback(async () => {
    if (!fileA || !fileB) return;

    setError(null);

    try {
      // 1. Upload both files to S3
      setStage("hashing");
      const [uploadA, uploadB] = await Promise.all([
        uploadFileToS3(fileA),
        uploadFileToS3(fileB),
      ]);

      setStage("uploading");

      // 2. Create both contracts with real S3 keys
      setStage("creating");
      const nameA = fileA.name.replace(/\.[^.]+$/, "");
      const nameB = fileB.name.replace(/\.[^.]+$/, "");

      const [contractA, contractB] = await Promise.all([
        createContract.mutateAsync({
          name: nameA,
          s3Key: uploadA.s3Key,
          filename: fileA.name,
          fileType: uploadA.fileType || undefined,
          fileSize: fileA.size || undefined,
          checksum: uploadA.checksum,
        }),
        createContract.mutateAsync({
          name: nameB,
          s3Key: uploadB.s3Key,
          filename: fileB.name,
          fileType: uploadB.fileType || undefined,
          fileSize: fileB.size || undefined,
          checksum: uploadB.checksum,
        }),
      ]);

      // 3. Create comparison
      setStage("comparing");
      const { comparison } = await createComparison.mutateAsync({
        contractAId: contractA.id,
        contractBId: contractB.id,
      });

      router.push(`/contracts/${contractA.id}/compare?comparisonId=${comparison.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStage("error");
    }
  }, [fileA, fileB, createContract, createComparison, router]);

  const stageLabels: Partial<Record<Stage, string>> = {
    hashing: "Computing checksums...",
    uploading: "Uploading files...",
    creating: "Creating contracts...",
    comparing: "Starting comparison...",
  };

  if (stage === "hashing" || stage === "uploading" || stage === "creating" || stage === "comparing") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {stageLabels[stage]}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-5" />
            Compare Two Contracts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Upload two contracts side by side to compare them.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DropZone
              label="Contract A"
              file={fileA}
              onDrop={handleDrop("a")}
              onClick={handleClick("a")}
            />
            <DropZone
              label="Contract B"
              file={fileB}
              onDrop={handleDrop("b")}
              onClick={handleClick("b")}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button
            onClick={handleCompare}
            disabled={!fileA || !fileB}
            className="w-full"
          >
            <GitCompareArrows className="size-4" data-icon="inline-start" />
            Compare Contracts
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DropZone({
  label,
  file,
  onDrop,
  onClick,
}: {
  label: string;
  file: File | null;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onDrop={(e) => {
        setIsDragOver(false);
        onDrop(e);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragOver(false);
      }}
      onClick={onClick}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-10 transition-colors ${
        isDragOver
          ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900"
          : file
            ? "border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-950/20"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
      }`}
    >
      <Upload className="mb-2 size-6 text-zinc-400" />
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</p>
      {file ? (
        <p className="mt-1 max-w-full truncate text-xs text-green-600 dark:text-green-400">
          {file.name}
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">Drop or click to select</p>
      )}
    </div>
  );
}
