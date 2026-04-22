"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { toast } from "sonner";

export function PortalSignaturesTab({ caseId }: { caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.portalSignatures.list.useQuery({ caseId });

  async function openSigning(requestId: string) {
    try {
      const res = await utils.portalSignatures.getSignUrl.fetch({ requestId });
      if (res?.url) window.open(res.url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  const requests = data?.requests ?? [];
  if (requests.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No signature requests.</p>;
  }

  return (
    <div className="p-4 space-y-3">
      {requests.map((r: any) => (
        <div key={r.id} className="rounded border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{r.title}</h3>
            <Badge>{r.status}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Sent {format(new Date(r.createdAt), "PP")}
          </div>
          {r.clientSigner?.status === "awaiting_signature" && (
            <div className="mt-3">
              <Button onClick={() => openSigning(r.id)}>Sign now</Button>
            </div>
          )}
          {r.clientSigner?.status === "signed" && r.clientSigner?.signedAt && (
            <div className="mt-2 text-sm text-green-700">✓ You signed on {format(new Date(r.clientSigner.signedAt), "PP")}</div>
          )}
        </div>
      ))}
    </div>
  );
}
