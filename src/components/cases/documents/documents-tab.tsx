// src/components/cases/documents/documents-tab.tsx
//
// Phase 3.12 — Per-case Documents tab. Lists firm documents generated from
// templates and exposes the Generate / Finalize / Mark Sent / Supersede /
// Download actions.
"use client";

import * as React from "react";
import { Plus, Download, Wand2, Send, Archive, FileText, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GenerateDocumentDialog } from "./generate-document-dialog";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-700",
  finalized: "bg-emerald-700",
  sent: "bg-blue-700",
  superseded: "bg-amber-700",
};

export function DocumentsTab({
  caseId,
  clientId,
}: {
  caseId?: string | null;
  clientId?: string | null;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = React.useState(false);

  const caseQ = trpc.documentTemplates.documents.listForCase.useQuery(
    { caseId: caseId ?? "" },
    { enabled: Boolean(caseId) },
  );
  const clientQ = trpc.documentTemplates.documents.listForClient.useQuery(
    { clientId: clientId ?? "" },
    { enabled: Boolean(clientId) && !caseId },
  );
  const docs = caseId ? caseQ.data : clientQ.data;
  const isLoading = caseId ? caseQ.isLoading : clientQ.isLoading;

  const finalizeMut = trpc.documentTemplates.documents.finalize.useMutation({
    onSuccess: () => {
      toast.success("Finalized");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markSentMut = trpc.documentTemplates.documents.markSent.useMutation({
    onSuccess: () => {
      toast.success("Marked sent");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const supersedeMut = trpc.documentTemplates.documents.supersede.useMutation({
    onSuccess: () => {
      toast.success("Superseded");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function invalidate() {
    if (caseId) utils.documentTemplates.documents.listForCase.invalidate({ caseId });
    if (clientId) utils.documentTemplates.documents.listForClient.invalidate({ clientId });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Generated Documents</h2>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4 mr-1" /> Generate Document
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" /> Loading...
        </div>
      )}

      {(docs ?? []).length === 0 && !isLoading && (
        <div className="rounded border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
          No documents generated yet. Click <strong>Generate Document</strong> to start.
        </div>
      )}

      <div className="space-y-2">
        {(docs ?? []).map((d) => (
          <div key={d.id} className="rounded border border-zinc-800 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-zinc-500" />
                <span className="font-medium">{d.title}</span>
                <Badge className={STATUS_COLORS[d.status] ?? ""}>{d.status}</Badge>
                <Badge variant="outline">{d.category}</Badge>
              </div>
              <div className="flex items-center gap-1">
                {d.status === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => finalizeMut.mutate({ docId: d.id })}
                    disabled={finalizeMut.isPending}
                  >
                    <Wand2 className="size-3.5 mr-1" /> Finalize
                  </Button>
                )}
                {(d.status === "finalized" || d.status === "sent") && (
                  <a href={`/api/case-documents/${d.id}/pdf`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline">
                      <Download className="size-3.5 mr-1" /> PDF
                    </Button>
                  </a>
                )}
                {d.status === "finalized" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markSentMut.mutate({ docId: d.id })}
                    disabled={markSentMut.isPending}
                  >
                    <Send className="size-3.5 mr-1" /> Mark sent
                  </Button>
                )}
                {d.status !== "superseded" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm("Mark this document as superseded?")) {
                        supersedeMut.mutate({ docId: d.id });
                      }
                    }}
                    disabled={supersedeMut.isPending}
                  >
                    <Archive className="size-3.5 mr-1" /> Supersede
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {new Date(d.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <GenerateDocumentDialog
        open={open}
        onOpenChange={setOpen}
        caseId={caseId ?? null}
        clientId={clientId ?? null}
      />
    </div>
  );
}
