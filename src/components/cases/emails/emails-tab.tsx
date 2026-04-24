"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { NewEmailModal } from "./new-email-modal";
import { EmailsList } from "./emails-list";
import { EmailDetail } from "./email-detail";
import { DripEnrollmentsPanel } from "./drip-enrollments-panel";

export function EmailsTab({ caseId }: { caseId: string }) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
    <DripEnrollmentsPanel caseId={caseId} />
    <div className="flex h-[calc(100vh-260px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Emails</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EmailsList caseId={caseId} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </aside>
      <section className="flex-1 overflow-y-auto">
        {selectedId ? (
          <EmailDetail emailId={selectedId} caseId={caseId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select an email or send a new one.</p>
        )}
      </section>
      <NewEmailModal caseId={caseId} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
    </div>
  );
}
