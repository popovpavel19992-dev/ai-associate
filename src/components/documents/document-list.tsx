"use client";

import { Trash2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DocumentStatus, FileType } from "@/lib/types";

interface DocumentItem {
  id: string;
  filename: string;
  fileSize: number;
  fileType: FileType;
  status: DocumentStatus;
}

interface DocumentListProps {
  documents: DocumentItem[];
  onRemove?: (documentId: string) => void;
  isRemoving?: boolean;
}

const STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  uploading: { label: "Uploading", variant: "secondary" },
  extracting: { label: "Extracting", variant: "secondary" },
  analyzing: { label: "Analyzing", variant: "secondary" },
  ready: { label: "Ready", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentList({
  documents,
  onRemove,
  isRemoving,
}: DocumentListProps) {
  if (documents.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        {documents.length} {documents.length === 1 ? "document" : "documents"}
      </p>
      <div className="space-y-2">
        {documents.map((doc) => (
          <DocumentCard
            key={doc.id}
            document={doc}
            onRemove={onRemove}
            isRemoving={isRemoving}
          />
        ))}
      </div>
    </div>
  );
}

function DocumentCard({
  document: doc,
  onRemove,
  isRemoving,
}: {
  document: DocumentItem;
  onRemove?: (id: string) => void;
  isRemoving?: boolean;
}) {
  const config = STATUS_CONFIG[doc.status];
  const canRemove = doc.status !== "analyzing" && doc.status !== "extracting";

  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc.filename}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(doc.fileSize)} · {doc.fileType.toUpperCase()}
        </p>
      </div>
      <Badge variant={config.variant}>{config.label}</Badge>
      {onRemove && canRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => onRemove(doc.id)}
          disabled={isRemoving}
        >
          {isRemoving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500" />
          )}
        </Button>
      )}
    </div>
  );
}
