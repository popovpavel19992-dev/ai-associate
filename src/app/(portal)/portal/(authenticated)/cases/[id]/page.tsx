"use client";

import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { CaseDetailTabs } from "@/components/portal/case-detail-tabs";
import { DocumentRequestsSection } from "@/components/portal/document-requests-section";

export default function PortalCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: caseData, isLoading } = trpc.portalCases.get.useQuery({ caseId: id });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!caseData) {
    return <p className="text-muted-foreground text-center py-12">Case not found</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/portal/cases">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">{caseData.name}</h1>
      </div>
      <DocumentRequestsSection caseId={caseData.id} />
      <CaseDetailTabs caseData={caseData} />
    </div>
  );
}
