"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

export default function DigestHistoryPage() {
  const { data: logs = [], isLoading } = trpc.caseDigest.listLogs.useQuery();
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = trpc.caseDigest.getLog.useQuery(
    { id: openId! },
    { enabled: !!openId },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Digest History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Past daily digests sent to your inbox.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sent digests</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No digests yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Sent at</th>
                  <th className="py-2">Subject</th>
                  <th className="py-2 text-right">Items</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setOpenId(l.id)}
                    className="cursor-pointer border-b hover:bg-zinc-50"
                  >
                    <td className="py-2">{new Date(l.sentAt).toLocaleString()}</td>
                    <td className="py-2">{l.subject}</td>
                    <td className="py-2 text-right">{l.itemCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Digest details</DialogTitle>
          </DialogHeader>
          {detail.data ? (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto text-sm">
              <div>
                <strong>Subject:</strong> {detail.data.subject}
              </div>
              <div>
                <strong>Sent:</strong> {new Date(detail.data.sentAt).toLocaleString()}
              </div>
              {detail.data.aiSummary && (
                <div className="rounded border-l-4 border-zinc-900 bg-zinc-50 p-3 whitespace-pre-wrap">
                  {detail.data.aiSummary}
                </div>
              )}
              {detail.data.payload ? (
                <pre className="rounded bg-zinc-100 p-3 text-xs overflow-x-auto">
                  {JSON.stringify(detail.data.payload, null, 2) ?? ""}
                </pre>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
