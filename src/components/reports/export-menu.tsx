"use client";

import { useState } from "react";
import { Download, FileText, File, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { saveAs } from "file-saver";

interface ExportMenuProps {
  caseId: string;
  caseName: string;
}

export function ExportMenu({ caseId, caseName }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  const exportDocx = trpc.cases.exportDocx.useMutation({
    onSuccess: (data) => {
      const blob = new Blob(
        [Uint8Array.from(atob(data.buffer), (c) => c.charCodeAt(0))],
        { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      );
      saveAs(blob, `${sanitizeFilename(caseName)}.docx`);
      setIsOpen(false);
    },
  });

  const exportText = trpc.cases.exportText.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.text], { type: "text/plain" });
      saveAs(blob, `${sanitizeFilename(caseName)}.txt`);
      setIsOpen(false);
    },
  });

  const isExporting = exportDocx.isPending || exportText.isPending;

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
      >
        {isExporting ? (
          <Loader2 className="mr-2 size-3.5 animate-spin" />
        ) : (
          <Download className="mr-2 size-3.5" />
        )}
        Export
      </Button>

      {isOpen && !isExporting && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-background shadow-md">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              onClick={() => exportDocx.mutate({ caseId })}
            >
              <FileText className="size-4 text-blue-600" />
              Download DOCX
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              onClick={() => exportText.mutate({ caseId })}
            >
              <File className="size-4 text-zinc-600" />
              Download Text
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "").slice(0, 100) || "report";
}
