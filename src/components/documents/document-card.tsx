"use client";

import * as React from "react";
import { FileText, Trash2, Loader2, Eye, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NewSignatureRequestModal } from "@/components/cases/signatures/new-signature-request-modal";
import type { DocumentStatus, FileType } from "@/lib/types";

interface DocumentCardProps {
  id: string;
  filename: string;
  fileSize: number;
  fileType: FileType;
  status: DocumentStatus;
  pageCount?: number | null;
  onRemove?: (id: string) => void;
  onView?: (id: string) => void;
  isRemoving?: boolean;
  /** When provided, a "Send for signature" button appears for PDF documents. */
  caseId?: string;
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

export function DocumentCard({
  id,
  filename,
  fileSize,
  fileType,
  status,
  pageCount,
  onRemove,
  onView,
  isRemoving,
  caseId,
}: DocumentCardProps) {
  const [sigModalOpen, setSigModalOpen] = React.useState(false);

  const config = STATUS_CONFIG[status];
  const canRemove = status !== "analyzing" && status !== "extracting";
  const isProcessing = status === "uploading" || status === "extracting" || status === "analyzing";

  return (
    <>
      <Card className="flex items-center gap-3 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted">
          <FileText className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{filename}</p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(fileSize)} · {fileType.toUpperCase()}
            {pageCount != null && ` · ${pageCount} pages`}
          </p>
        </div>
        <Badge variant={config.variant}>
          {isProcessing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {config.label}
        </Badge>
        <div className="flex shrink-0 gap-1">
          {onView && status === "ready" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onView(id)}
            >
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
          {caseId && fileType === "pdf" && status === "ready" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Send for signature"
              onClick={() => setSigModalOpen(true)}
            >
              <FileSignature className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
          {onRemove && canRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onRemove(id)}
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
      </Card>
      {caseId && sigModalOpen && (
        <NewSignatureRequestModal
          caseId={caseId}
          open={sigModalOpen}
          onOpenChange={setSigModalOpen}
          initialSourceDocumentId={id}
        />
      )}
    </>
  );
}
