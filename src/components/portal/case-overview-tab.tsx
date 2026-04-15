"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CaseOverviewTabProps {
  name: string;
  status: string;
  detectedCaseType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function CaseOverviewTab({ name, status, detectedCaseType, createdAt, updatedAt }: CaseOverviewTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Case Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Case Name</p>
            <p className="text-sm">{name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <Badge variant="secondary">{status}</Badge>
          </div>
          {detectedCaseType && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Case Type</p>
              <p className="text-sm">{detectedCaseType}</p>
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Created</p>
            <p className="text-sm">{new Date(createdAt).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
            <p className="text-sm">{new Date(updatedAt).toLocaleDateString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
