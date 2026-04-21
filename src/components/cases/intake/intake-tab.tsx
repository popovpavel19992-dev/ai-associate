// src/components/cases/intake/intake-tab.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NewIntakeFormModal } from "./new-intake-form-modal";
import { IntakeFormDetail } from "./intake-form-detail";

const REQ_STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
};

export function IntakeTab({ caseId }: { caseId: string }) {
  const { data } = trpc.intakeForms.list.useQuery({ caseId });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const forms = data?.forms ?? [];
  const active = selectedId ?? forms[0]?.id ?? null;

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Intake Forms</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {forms.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No forms yet. Create one to ask the client structured questions.</p>
          ) : (
            <ul>
              {forms.map((f) => {
                const isActive = f.id === active;
                return (
                  <li
                    key={f.id}
                    className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                    onClick={() => setSelectedId(f.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{f.title}</span>
                      <Badge className={REQ_STATUS_STYLES[f.status]}>{f.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                      <span>{f.answeredCount}/{f.requiredCount} required answered</span>
                      <span>{formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}</span>
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
          <IntakeFormDetail formId={active} caseId={caseId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a form or create a new one.</p>
        )}
      </section>
      <NewIntakeFormModal
        caseId={caseId}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
