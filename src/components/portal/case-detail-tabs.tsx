"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CaseOverviewTab } from "./case-overview-tab";
import { CaseDocumentsTab } from "./case-documents-tab";
import { CaseMessagesTab } from "./case-messages-tab";
import { CaseTasksTab } from "./case-tasks-tab";
import { CaseCalendarTab } from "./case-calendar-tab";
import { CaseInvoicesTab } from "./case-invoices-tab";
import { PortalSignaturesTab } from "./portal-signatures-tab";

interface CaseDetailTabsProps {
  caseData: {
    id: string;
    name: string;
    status: string;
    detectedCaseType: string | null;
    portalVisibility: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
}

export function CaseDetailTabs({ caseData }: CaseDetailTabsProps) {
  const vis = (caseData.portalVisibility ?? {}) as Record<string, boolean>;

  const tabs = [
    { key: "overview", label: "Overview", visible: true },
    { key: "documents", label: "Documents", visible: vis.documents !== false },
    { key: "messages", label: "Messages", visible: vis.messages !== false },
    { key: "tasks", label: "Tasks", visible: vis.tasks !== false },
    { key: "calendar", label: "Calendar", visible: vis.calendar !== false },
    { key: "invoices", label: "Invoices", visible: vis.billing !== false },
    { key: "signatures", label: "Signatures", visible: true },
  ].filter((t) => t.visible);

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="mt-4">
        <TabsContent value="overview">
          <CaseOverviewTab
            name={caseData.name}
            status={caseData.status}
            detectedCaseType={caseData.detectedCaseType}
            createdAt={caseData.createdAt}
            updatedAt={caseData.updatedAt}
          />
        </TabsContent>

        {vis.documents !== false && (
          <TabsContent value="documents">
            <CaseDocumentsTab caseId={caseData.id} />
          </TabsContent>
        )}

        {vis.messages !== false && (
          <TabsContent value="messages">
            <CaseMessagesTab caseId={caseData.id} />
          </TabsContent>
        )}

        {vis.tasks !== false && (
          <TabsContent value="tasks">
            <CaseTasksTab caseId={caseData.id} />
          </TabsContent>
        )}

        {vis.calendar !== false && (
          <TabsContent value="calendar">
            <CaseCalendarTab caseId={caseData.id} />
          </TabsContent>
        )}

        {vis.billing !== false && (
          <TabsContent value="invoices">
            <CaseInvoicesTab caseId={caseData.id} />
          </TabsContent>
        )}

        <TabsContent value="signatures">
          <PortalSignaturesTab caseId={caseData.id} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
