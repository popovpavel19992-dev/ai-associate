"use client";

import Link from "next/link";
import { FileText, Clock, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CASE_TYPE_LABELS } from "@/lib/constants";
import type { CaseStatus } from "@/lib/types";

interface CaseCardProps {
  id: string;
  name: string;
  status: CaseStatus;
  caseType: string | null;
  docCount: number;
  createdAt: Date;
}

const STATUS_CONFIG: Record<
  CaseStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }
> = {
  draft: { label: "Draft", variant: "outline", icon: Clock },
  processing: { label: "Processing", variant: "secondary", icon: Loader2 },
  ready: { label: "Ready", variant: "default", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "destructive", icon: AlertCircle },
};

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CaseCard({ id, name, status, caseType, docCount, createdAt }: CaseCardProps) {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  return (
    <Link href={`/cases/${id}`}>
      <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {caseType ? (CASE_TYPE_LABELS[caseType] ?? caseType) : "Auto-detect"}
            {" · "}
            {docCount} {docCount === 1 ? "doc" : "docs"}
            {" · "}
            {formatRelativeDate(new Date(createdAt))}
          </p>
        </div>
        <Badge variant={config.variant} className="shrink-0 gap-1">
          <StatusIcon
            className={`h-3 w-3 ${status === "processing" ? "animate-spin" : ""}`}
          />
          {config.label}
        </Badge>
      </Card>
    </Link>
  );
}
