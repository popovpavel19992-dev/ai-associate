"use client";

import Link from "next/link";
import { Clock, Loader2, CheckCircle2, AlertCircle, FileEdit } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CONTRACT_TYPE_LABELS } from "@/lib/constants";
import type { DraftStatus } from "@/lib/types";

interface DraftCardProps {
  draft: {
    id: string;
    name: string;
    status: DraftStatus;
    contractType: string;
    createdAt: Date;
  };
}

const STATUS_CONFIG: Record<
  DraftStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }
> = {
  draft: { label: "Draft", variant: "outline", icon: FileEdit },
  generating: { label: "Generating", variant: "secondary", icon: Loader2 },
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

export function DraftCard({ draft }: DraftCardProps) {
  const config = STATUS_CONFIG[draft.status];
  const StatusIcon = config.icon;
  const isSpinning = draft.status === "generating";

  return (
    <Link href={`/drafts/${draft.id}`}>
      <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{draft.name}</p>
          <p className="text-xs text-muted-foreground">
            {CONTRACT_TYPE_LABELS[draft.contractType] ?? draft.contractType}
            {" \u00b7 "}
            {formatRelativeDate(new Date(draft.createdAt))}
          </p>
        </div>
        <Badge variant={config.variant} className="shrink-0 gap-1">
          <StatusIcon
            className={`h-3 w-3 ${isSpinning ? "animate-spin" : ""}`}
          />
          {config.label}
        </Badge>
      </Card>
    </Link>
  );
}
