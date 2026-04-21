"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { NewRequestModal } from "./new-request-modal";
import { RequestDetailPanel } from "./request-detail-panel";

const REQ_STATUS_STYLES: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  awaiting_review: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
};

export function RequestsTab({ caseId }: { caseId: string }) {
  const { data } = trpc.documentRequests.list.useQuery({ caseId });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const requests = data?.requests ?? [];
  const active = selectedId ?? requests[0]?.id ?? null;

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Document Requests</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {requests.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No requests yet. Create one to ask the client for documents.
            </p>
          ) : (
            <ul>
              {requests.map((r) => {
                const isActive = r.id === active;
                return (
                  <li
                    key={r.id}
                    className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{r.title}</span>
                      <Badge className={REQ_STATUS_STYLES[r.status]}>{r.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                      <span>
                        {r.reviewedCount}/{r.itemCount} reviewed
                      </span>
                      {r.dueAt ? (
                        <span className={new Date(r.dueAt) < new Date() ? "text-red-600" : ""}>
                          Due {format(new Date(r.dueAt), "MMM d")}
                        </span>
                      ) : (
                        <span>{formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      <section className="flex-1 overflow-y-auto">
        {active ? (
          <RequestDetailPanel requestId={active} caseId={caseId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a request or create a new one.</p>
        )}
      </section>
      <NewRequestModal
        caseId={caseId}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
