// src/app/(app)/settings/conflict-checks/page.tsx
//
// Phase 3.6 — Conflict Checks audit log page.
"use client";

import { useState } from "react";
import { ShieldAlert, AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Severity = "HIGH" | "MEDIUM" | "LOW";

const SOURCE_LABELS: Record<string, string> = {
  client: "Existing client",
  opposing_party: "Opposing party",
  opposing_counsel: "Opposing counsel",
  witness: "Witness",
  subpoena_recipient: "Subpoena recipient",
  mediator: "Mediator",
  demand_recipient: "Demand letter recipient",
};

function severityBadge(s: Severity | null) {
  if (!s)
    return (
      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-500">
        none
      </Badge>
    );
  const cls =
    s === "HIGH"
      ? "bg-red-500/15 text-red-500 border-red-500/30"
      : s === "MEDIUM"
        ? "bg-yellow-500/15 text-yellow-500 border-yellow-500/30"
        : "bg-blue-500/15 text-blue-500 border-blue-500/30";
  return (
    <Badge variant="outline" className={cls}>
      {s}
    </Badge>
  );
}

function severityIcon(s: Severity) {
  if (s === "HIGH") return <AlertOctagon className="h-4 w-4 text-red-500" />;
  if (s === "MEDIUM") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
}

export default function ConflictChecksPage() {
  const { data, isLoading } = trpc.conflictChecker.listLogs.useQuery({
    limit: 50,
    offset: 0,
  });
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const detail = trpc.conflictChecker.getLog.useQuery(
    { logId: openLogId! },
    { enabled: !!openLogId },
  );

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-semibold">Conflict Checks</h1>
          <p className="text-sm text-muted-foreground">
            Audit log of every conflict-of-interest check performed by the firm.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Checks</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !data || data.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No conflict checks have been performed yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Query</th>
                    <th className="py-2 pr-3">Hits</th>
                    <th className="py-2 pr-3">Severity</th>
                    <th className="py-2 pr-3">Context</th>
                    <th className="py-2 pr-3">Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-muted-foreground">
                        {new Date(l.performedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 font-medium">{l.queryName}</td>
                      <td className="py-2 pr-3">{l.hitsFound}</td>
                      <td className="py-2 pr-3">
                        {severityBadge(l.highestSeverity as Severity | null)}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {l.context.replace("_", " ")}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {l.resultedInCreation ? "Created" : l.hitsFound > 0 ? "Cancelled" : "Clean"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setOpenLogId(l.id)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                Showing {data.logs.length} of {data.total} total checks.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openLogId} onOpenChange={(o) => !o && setOpenLogId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conflict Check Detail</DialogTitle>
            <DialogDescription>
              {detail.data?.log
                ? `Performed ${new Date(detail.data.log.performedAt).toLocaleString()}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          {detail.data?.log && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Query</div>
                  <div className="font-medium">{detail.data.log.queryName}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Context</div>
                  <div>{detail.data.log.context.replace("_", " ")}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Highest severity</div>
                  <div>
                    {severityBadge(detail.data.log.highestSeverity as Severity | null)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Hits</div>
                  <div>{detail.data.log.hitsFound}</div>
                </div>
              </div>

              {detail.data.log.hits.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Matches</h4>
                  <ul className="space-y-2">
                    {detail.data.log.hits.map((h, i) => (
                      <li
                        key={i}
                        className="rounded-md border bg-muted/30 p-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          {severityIcon(h.severity)}
                          <span className="font-medium">{h.matchedValue}</span>
                          {severityBadge(h.severity)}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-muted-foreground">
                          <span>{SOURCE_LABELS[h.source] ?? h.source}</span>
                          {h.caseName && <span>Case: {h.caseName}</span>}
                          <span>{h.matchType.replace("_", " ")}</span>
                          <span>{(h.similarity * 100).toFixed(0)}%</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.data.override && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                  <div className="text-xs font-semibold uppercase text-red-500">
                    Override recorded
                  </div>
                  <div className="mt-1 text-sm">{detail.data.override.reason}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Approved {new Date(detail.data.override.approvedAt).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
