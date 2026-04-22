// src/components/cases/signatures/signatures-tab.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { SignaturesList } from "./signatures-list";
import { SignatureDetail } from "./signature-detail";
import { NewSignatureRequestModal } from "./new-signature-request-modal";

export function SignaturesTab({ caseId }: { caseId: string }) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Signatures</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SignaturesList caseId={caseId} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </aside>
      <section className="flex-1 overflow-y-auto">
        {selectedId ? (
          <SignatureDetail requestId={selectedId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a request or start a new one.</p>
        )}
      </section>
      <NewSignatureRequestModal caseId={caseId} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
