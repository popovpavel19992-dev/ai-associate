"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Download, Upload, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export function CaseDocumentsTab({ caseId }: { caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.portalDocuments.list.useQuery({ caseId });
  const [uploading, setUploading] = useState(false);

  const uploadMutation = trpc.portalDocuments.upload.useMutation();
  const confirmMutation = trpc.portalDocuments.confirmUpload.useMutation({
    onSuccess: () => utils.portalDocuments.list.invalidate({ caseId }),
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const fileType = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "image";

      const { uploadUrl, documentId } = await uploadMutation.mutateAsync({
        caseId,
        filename: file.name,
        fileType: fileType as "pdf" | "docx" | "image",
      });

      await fetch(uploadUrl, { method: "PUT", body: file });
      await confirmMutation.mutateAsync({ documentId });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDownload = async (documentId: string) => {
    const { url } = await utils.portalDocuments.getDownloadUrl.fetch({ documentId });
    window.open(url, "_blank");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        <label className="cursor-pointer">
          <Button variant="outline" size="sm" disabled={uploading} type="button">
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Upload
          </Button>
          <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.docx,.jpg,.jpeg,.png" />
        </label>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.documents?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">No documents</p>
        ) : (
          <div className="space-y-2">
            {data.documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDownload(doc.id)}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
