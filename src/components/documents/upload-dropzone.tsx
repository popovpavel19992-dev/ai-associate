"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpload, type FileUploadState } from "@/hooks/use-upload";
import { Progress } from "@/components/ui/progress";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/jpeg",
  "image/png",
];

const ACCEPTED_EXTENSIONS = ".pdf,.doc,.docx,.jpg,.jpeg,.png";

interface UploadDropzoneProps {
  caseId: string;
  onUploadComplete?: () => void;
}

export function UploadDropzone({ caseId, onUploadComplete }: UploadDropzoneProps) {
  const { uploads, uploadFiles, isUploading } = useUpload(caseId);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const files = Array.from(fileList).filter((f) =>
        ACCEPTED_TYPES.includes(f.type),
      );
      if (files.length > 0) {
        uploadFiles(files);
        onUploadComplete?.();
      }
    },
    [uploadFiles, onUploadComplete],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-colors",
          isDragOver
            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600",
        )}
      >
        <Upload className="mb-3 h-8 w-8 text-zinc-400" />
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {isDragOver ? "Drop files here" : "Drag & drop files, or click to browse"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          PDF, DOCX, JPEG, PNG — max 25MB per file
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload, i) => (
            <UploadItem key={i} upload={upload} />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadItem({ upload }: { upload: FileUploadState }) {
  const { file, status, progress, error } = upload;

  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        {status === "error" ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : status === "done" ? (
          <p className="text-xs text-green-600">Uploaded</p>
        ) : (
          <Progress value={progress} className="mt-1 h-1.5" />
        )}
      </div>
      <span className="shrink-0 text-xs text-zinc-500">
        {(file.size / 1024 / 1024).toFixed(1)} MB
      </span>
    </div>
  );
}

function StatusIcon({ status }: { status: FileUploadState["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />;
    case "error":
      return <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />;
    case "idle":
      return <FileText className="h-4 w-4 shrink-0 text-zinc-400" />;
    default:
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" />;
  }
}
