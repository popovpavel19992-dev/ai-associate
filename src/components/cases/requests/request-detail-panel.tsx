"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, X, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  awaiting_review: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground line-through",
  pending: "bg-gray-100 text-gray-700",
  uploaded: "bg-blue-100 text-blue-800",
  reviewed: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export function RequestDetailPanel({ requestId, caseId }: { requestId: string; caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.documentRequests.get.useQuery({ requestId });
  const [rejectingItem, setRejectingItem] = useState<{ id: string; name: string } | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const review = trpc.documentRequests.reviewItem.useMutation({
    onSuccess: async () => {
      await utils.documentRequests.get.invalidate({ requestId });
      await utils.documentRequests.list.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = trpc.documentRequests.rejectItem.useMutation({
    onSuccess: async () => {
      await utils.documentRequests.get.invalidate({ requestId });
      await utils.documentRequests.list.invalidate({ caseId });
      setRejectingItem(null);
      setRejectNote("");
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.documentRequests.cancel.useMutation({
    onSuccess: async () => {
      await utils.documentRequests.list.invalidate({ caseId });
      toast.success("Request cancelled");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">Request not found</div>;

  const filesByItem = new Map(data.files.map((f) => [f.itemId, f.files]));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{data.request.title}</h3>
          {data.request.note && (
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{data.request.note}</p>
          )}
          {data.request.dueAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Due {format(new Date(data.request.dueAt), "PP")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_STYLES[data.request.status]}>{data.request.status}</Badge>
          {data.request.status !== "cancelled" && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ requestId })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <ul className="space-y-2">
        {data.items.map((item) => {
          const files = filesByItem.get(item.id) ?? [];
          return (
            <li key={item.id} className="border rounded p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_STYLES[item.status]}>{item.status}</Badge>
                    <span className="font-medium truncate">{item.name}</span>
                  </div>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  )}
                  {item.rejectionNote && (
                    <p className="text-sm text-red-700 mt-1">Rejection note: {item.rejectionNote}</p>
                  )}
                  {files.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {files.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 text-sm">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="truncate">{f.filename ?? "(unnamed)"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {item.status === "uploaded" && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => review.mutate({ itemId: item.id })}>
                      <Check className="w-4 h-4 mr-1" /> Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectingItem({ id: item.id, name: item.name })}
                    >
                      <X className="w-4 h-4 mr-1" /> Reject
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={!!rejectingItem}
        onOpenChange={(o) => {
          if (!o) {
            setRejectingItem(null);
            setRejectNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject: {rejectingItem?.name}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={4}
            placeholder="Tell the client what's wrong so they can upload a correct document."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                rejectingItem &&
                reject.mutate({ itemId: rejectingItem.id, rejectionNote: rejectNote.trim() })
              }
              disabled={!rejectNote.trim() || reject.isPending}
            >
              Send rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
