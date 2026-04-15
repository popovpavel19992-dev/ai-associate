"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const SECTIONS = [
  { key: "documents", label: "Documents" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
  { key: "billing", label: "Billing" },
  { key: "messages", label: "Messages" },
] as const;

type Visibility = Record<string, boolean>;

export function PortalVisibilityPanel({ caseId, portalVisibility }: { caseId: string; portalVisibility: unknown }) {
  const utils = trpc.useUtils();
  const vis = (portalVisibility ?? { documents: true, tasks: true, calendar: true, billing: true, messages: true }) as Visibility;

  const update = trpc.cases.updatePortalVisibility.useMutation({
    onSuccess: () => utils.cases.getById.invalidate({ caseId }),
  });

  const toggle = (key: string) => {
    const newVis = { ...vis, [key]: !vis[key] };
    update.mutate({
      caseId,
      visibility: {
        documents: newVis.documents ?? true,
        tasks: newVis.tasks ?? true,
        calendar: newVis.calendar ?? true,
        billing: newVis.billing ?? true,
        messages: newVis.messages ?? true,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Portal Visibility</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {SECTIONS.map((section) => (
          <div key={section.key} className="flex items-center justify-between">
            <span className="text-xs">{section.label}</span>
            <Button
              variant={vis[section.key] !== false ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => toggle(section.key)}
              disabled={update.isPending}
            >
              {vis[section.key] !== false ? "Visible" : "Hidden"}
            </Button>
          </div>
        ))}
        {update.isPending && (
          <div className="flex justify-center">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
