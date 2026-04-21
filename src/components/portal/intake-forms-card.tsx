"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
};

export function IntakeFormsCard({ caseId }: { caseId: string }) {
  const { data } = trpc.portalIntakeForms.list.useQuery({ caseId });

  const active = (data?.forms ?? []).filter((f) => f.status === "sent" || f.status === "in_progress");
  const closed = (data?.forms ?? []).filter((f) => f.status === "submitted");
  if (active.length === 0 && closed.length === 0) return null;

  return (
    <section className="mb-6 space-y-3">
      <h2 className="text-lg font-semibold">Intake Forms</h2>
      {active.map((f) => (
        <Card key={f.id}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{f.title}</span>
                <Badge className={STATUS_STYLES[f.status]}>{f.status}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {f.answeredCount}/{f.requiredCount} required answered
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Link href={`/portal/intake/${f.id}`}>
              <Button size="sm">{f.status === "sent" ? "Start" : "Continue"}</Button>
            </Link>
          </CardContent>
        </Card>
      ))}
      {closed.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Submitted ({closed.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {closed.map((f) => (
              <li key={f.id} className="text-sm flex items-center gap-2">
                <Badge className={STATUS_STYLES[f.status]}>submitted</Badge>
                <span>{f.title}</span>
                <span className="text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
