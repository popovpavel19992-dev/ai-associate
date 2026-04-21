"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { NewMilestoneModal } from "./new-milestone-modal";
import { MilestoneDetail } from "./milestone-detail";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  published: "bg-green-100 text-green-800",
  retracted: "bg-muted text-muted-foreground",
};

const CATEGORY_STYLES: Record<string, string> = {
  filing: "bg-blue-100 text-blue-800",
  discovery: "bg-purple-100 text-purple-800",
  hearing: "bg-amber-100 text-amber-800",
  settlement: "bg-green-100 text-green-800",
  communication: "bg-gray-100 text-gray-700",
  other: "bg-slate-100 text-slate-700",
};

export function UpdatesTab({ caseId }: { caseId: string }) {
  const { data } = trpc.milestones.list.useQuery({ caseId });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const milestones = data?.milestones ?? [];
  const active = selectedId ?? milestones[0]?.id ?? null;

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Updates</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {milestones.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No updates yet. Create one to keep the client informed.</p>
          ) : (
            <ul>
              {milestones.map((m) => {
                const isActive = m.id === active;
                return (
                  <li
                    key={m.id}
                    className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{m.title}</span>
                      <Badge className={STATUS_STYLES[m.status] ?? ""}>{m.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <Badge className={CATEGORY_STYLES[m.category] ?? ""}>{m.category}</Badge>
                      <span>{format(new Date(m.occurredAt), "MMM d, yyyy")}</span>
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
          <MilestoneDetail milestoneId={active} caseId={caseId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a milestone or create a new one.</p>
        )}
      </section>
      <NewMilestoneModal
        caseId={caseId}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
