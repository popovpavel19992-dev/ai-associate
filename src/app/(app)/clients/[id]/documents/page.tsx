// src/app/(app)/clients/[id]/documents/page.tsx
//
// Phase 3.12 — per-client generated documents (e.g. an initial retainer
// signed before any case is opened). Same DocumentsTab UI used on a case;
// here it scopes by clientId only.
"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentsTab } from "@/components/cases/documents/documents-tab";

export default function ClientDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <div className="space-y-2">
      <div className="px-4 pt-4">
        <Link href={`/clients/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back to client
          </Button>
        </Link>
      </div>
      <DocumentsTab clientId={id} />
    </div>
  );
}
