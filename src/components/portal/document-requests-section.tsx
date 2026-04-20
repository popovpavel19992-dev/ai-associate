"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Upload, FileText } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  awaiting_review: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  pending: "bg-gray-100 text-gray-700",
  uploaded: "bg-blue-100 text-blue-800",
  reviewed: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export function DocumentRequestsSection({ caseId }: { caseId: string }) {
  const { data } = trpc.portalDocumentRequests.list.useQuery({ caseId });
  const [expanded, setExpanded] = useState<string | null>(null);

  const requests = (data?.requests ?? []).filter(
    (r) => r.status !== "completed" && r.status !== "cancelled",
  );
  const closed = (data?.requests ?? []).filter((r) => r.status === "completed");

  if (requests.length === 0 && closed.length === 0) return null;

  return (
    <section className="mb-6 space-y-3">
      <h2 className="text-lg font-semibold">Document Requests</h2>
      {requests.map((r) => (
        <Card key={r.id}>
          <CardHeader
            className="cursor-pointer"
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {expanded === r.id ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <span className="font-medium">{r.title}</span>
                <Badge className={STATUS_STYLES[r.status]}>{r.status}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {r.reviewedCount}/{r.itemCount} done
                {r.dueAt && (
                  <span
                    className={
                      new Date(r.dueAt) < new Date()
                        ? " text-red-600 ml-3"
                        : " ml-3"
                    }
                  >
                    Due {format(new Date(r.dueAt), "MMM d")}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>
          {expanded === r.id && (
            <CardContent>
              <RequestItems requestId={r.id} caseId={caseId} />
            </CardContent>
          )}
        </Card>
      ))}
      {closed.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            History ({closed.length} completed)
          </summary>
          <ul className="mt-2 space-y-1">
            {closed.map((r) => (
              <li key={r.id} className="text-sm flex items-center gap-2">
                <Badge className={STATUS_STYLES[r.status]}>{r.status}</Badge>
                <span>{r.title}</span>
                <span className="text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function RequestItems({
  requestId,
  caseId,
}: {
  requestId: string;
  caseId: string;
}) {
  const utils = trpc.useUtils();
  const { data } = trpc.portalDocumentRequests.get.useQuery({ requestId });
  const uploadMutation = trpc.portalDocuments.upload.useMutation();
  const confirmMutation = trpc.portalDocuments.confirmUpload.useMutation();
  const attach = trpc.portalDocumentRequests.attachUploaded.useMutation({
    onSuccess: async () => {
      await utils.portalDocumentRequests.get.invalidate({ requestId });
      await utils.portalDocumentRequests.list.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!data)
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  const filesByItem = new Map(data.files.map((f) => [f.itemId, f.files]));

  async function handleUpload(itemId: string, file: File) {
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const fileType: "pdf" | "docx" | "image" =
        ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "image";

      const { uploadUrl, documentId } = await uploadMutation.mutateAsync({
        caseId,
        filename: file.name,
        fileType,
      });

      const putResp = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!putResp.ok) {
        toast.error("Upload failed");
        return;
      }
      await confirmMutation.mutateAsync({ documentId });
      await attach.mutateAsync({ itemId, documentId });
      toast.success("Uploaded");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    }
  }

  return (
    <ul className="space-y-2">
      {data.items.map((item) => {
        const files = filesByItem.get(item.id) ?? [];
        return (
          <li key={item.id} className="border rounded p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_STYLES[item.status]}>
                    {item.status}
                  </Badge>
                  <span className="font-medium">{item.name}</span>
                </div>
                {item.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {item.description}
                  </p>
                )}
                {item.status === "rejected" && item.rejectionNote && (
                  <p className="text-sm text-red-700 mt-1">
                    Needs revision: {item.rejectionNote}
                  </p>
                )}
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {files.map((f) => (
                      <li key={f.id} className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {f.filename ?? "(file)"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {(item.status === "pending" ||
                item.status === "rejected" ||
                item.status === "uploaded") && (
                <UploadButton onFile={(f) => handleUpload(item.id, f)} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function UploadButton({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => ref.current?.click()}
      >
        <Upload className="w-4 h-4 mr-1" /> Upload
      </Button>
      <input
        type="file"
        ref={ref}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          if (ref.current) ref.current.value = "";
        }}
      />
    </>
  );
}
