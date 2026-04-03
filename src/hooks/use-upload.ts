"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { MAX_FILE_SIZE } from "@/lib/constants";

export type UploadStatus = "idle" | "hashing" | "presigning" | "uploading" | "confirming" | "done" | "error";

export interface FileUploadState {
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
}

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useUpload(caseId: string) {
  const [uploads, setUploads] = useState<Map<string, FileUploadState>>(
    new Map(),
  );

  const confirmUpload = trpc.documents.confirmUpload.useMutation();

  const updateUpload = useCallback(
    (key: string, update: Partial<FileUploadState>) => {
      setUploads((prev) => {
        const next = new Map(prev);
        const current = next.get(key);
        if (current) {
          next.set(key, { ...current, ...update });
        }
        return next;
      });
    },
    [],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const key = `${file.name}-${file.size}-${Date.now()}`;

      setUploads((prev) => {
        const next = new Map(prev);
        next.set(key, { file, status: "idle", progress: 0 });
        return next;
      });

      try {
        // Validate client-side
        if (file.size > MAX_FILE_SIZE) {
          updateUpload(key, {
            status: "error",
            error: "File exceeds 25MB limit",
          });
          return;
        }

        // Hash
        updateUpload(key, { status: "hashing", progress: 10 });
        const checksumSha256 = await computeSha256(file);

        // Get presigned URL
        updateUpload(key, { status: "presigning", progress: 20 });
        const presignRes = await fetch("/api/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            fileSize: file.size,
            caseId,
          }),
        });

        if (!presignRes.ok) {
          const err = await presignRes.json();
          throw new Error(err.error ?? "Failed to get upload URL");
        }

        const { uploadUrl, s3Key, fileType } = await presignRes.json();

        // Upload to S3
        updateUpload(key, { status: "uploading", progress: 40 });

        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!uploadRes.ok) {
          throw new Error("Failed to upload file to storage");
        }

        updateUpload(key, { progress: 80 });

        // Confirm upload in DB
        updateUpload(key, { status: "confirming", progress: 90 });
        await confirmUpload.mutateAsync({
          caseId,
          filename: file.name,
          s3Key,
          checksumSha256,
          fileType,
          fileSize: file.size,
        });

        updateUpload(key, { status: "done", progress: 100 });
      } catch (err) {
        updateUpload(key, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [caseId, confirmUpload, updateUpload],
  );

  const uploadFiles = useCallback(
    (files: File[]) => {
      files.forEach(uploadFile);
    },
    [uploadFile],
  );

  const clearCompleted = useCallback(() => {
    setUploads((prev) => {
      const next = new Map(prev);
      for (const [key, state] of next) {
        if (state.status === "done" || state.status === "error") {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  return {
    uploads: Array.from(uploads.values()),
    uploadFiles,
    clearCompleted,
    isUploading: Array.from(uploads.values()).some(
      (u) =>
        u.status !== "idle" && u.status !== "done" && u.status !== "error",
    ),
  };
}
