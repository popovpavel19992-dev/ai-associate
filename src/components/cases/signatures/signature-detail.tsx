// src/components/cases/signatures/signature-detail.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, FileText, X, Bell } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-800",
  sent: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  expired: "bg-zinc-200 text-zinc-800",
  cancelled: "bg-zinc-200 text-zinc-800",
};

export function SignatureDetail({ requestId }: { requestId: string }) {
  const utils = trpc.useUtils();
  const { data } = trpc.caseSignatures.get.useQuery({ requestId });
  const cancel = trpc.caseSignatures.cancel.useMutation({
    onSuccess: async () => {
      toast.success("Request cancelled");
      await utils.caseSignatures.list.invalidate();
      await utils.caseSignatures.get.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });
  const remind = trpc.caseSignatures.remind.useMutation({
    onSuccess: () => toast.success("Reminder sent"),
    onError: (e) => toast.error(e.message),
  });
  const downloadSigned = trpc.caseSignatures.downloadSigned.useQuery({ requestId }, { enabled: false });
  const downloadCert = trpc.caseSignatures.downloadCertificate.useQuery({ requestId }, { enabled: false });

  if (!data) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold truncate">{data.title}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            Created {format(new Date(data.createdAt), "PP p")} · {data.requiresCountersign ? "with countersign" : "client only"}
          </div>
        </div>
        <Badge className={STATUS_STYLES[data.status] ?? ""}>{data.status}</Badge>
      </div>

      {data.status === "declined" && data.declinedReason && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          <strong>Declined:</strong> {data.declinedReason}
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2">Role</th>
            <th className="p-2">Signer</th>
            <th className="p-2">Status</th>
            <th className="p-2">Signed</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {(data.signers ?? []).map((s) => (
            <tr key={s.id} className="border-t">
              <td className="p-2 capitalize">{s.signerRole}</td>
              <td className="p-2">{s.name ? `${s.name} · ` : ""}{s.email}</td>
              <td className="p-2">{s.status}</td>
              <td className="p-2">{s.signedAt ? format(new Date(s.signedAt), "PP p") : "—"}</td>
              <td className="p-2 text-right">
                {s.status === "awaiting_signature" && (
                  <Button size="sm" variant="ghost" onClick={() => remind.mutate({ requestId, signerEmail: s.email })}>
                    <Bell className="size-3 mr-1" /> Remind
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.status === "completed" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={async () => {
            const { data: r } = await downloadSigned.refetch();
            if (r?.url) window.open(r.url, "_blank");
          }}>
            <Download className="size-4 mr-1" /> Signed PDF
          </Button>
          <Button size="sm" variant="outline" onClick={async () => {
            const { data: r } = await downloadCert.refetch();
            if (r?.url) window.open(r.url, "_blank");
          }}>
            <FileText className="size-4 mr-1" /> Certificate
          </Button>
        </div>
      )}

      {(data.status === "sent" || data.status === "in_progress") && (
        <div>
          <Button size="sm" variant="destructive" onClick={() => {
            if (confirm("Cancel this signature request?")) cancel.mutate({ requestId });
          }}>
            <X className="size-4 mr-1" /> Cancel request
          </Button>
        </div>
      )}
    </div>
  );
}
