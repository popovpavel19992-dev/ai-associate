"use client";

import Link from "next/link";
import { FileText, Clock, Loader2, CheckCircle2, AlertCircle, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CONTRACT_TYPE_LABELS } from "@/lib/constants";
import { RiskBadge } from "./risk-badge";
import type { ContractStatus } from "@/lib/types";

interface ContractCardProps {
  id: string;
  name: string;
  status: ContractStatus;
  contractType: string | null;
  riskScore: number | null;
  clauseCount: number;
  createdAt: Date;
}

const STATUS_CONFIG: Record<
  ContractStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }
> = {
  draft: { label: "Draft", variant: "outline", icon: Clock },
  uploading: { label: "Uploading", variant: "secondary", icon: Upload },
  extracting: { label: "Extracting", variant: "secondary", icon: Loader2 },
  analyzing: { label: "Analyzing", variant: "secondary", icon: Loader2 },
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

export function ContractCard({
  id,
  name,
  status,
  contractType,
  riskScore,
  clauseCount,
  createdAt,
}: ContractCardProps) {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;
  const isSpinning = status === "uploading" || status === "extracting" || status === "analyzing";

  return (
    <Link href={`/contracts/${id}`}>
      <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50">
        <RiskBadge score={riskScore} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {contractType ? (CONTRACT_TYPE_LABELS[contractType] ?? contractType) : "Auto-detect"}
            {" \u00b7 "}
            {clauseCount} {clauseCount === 1 ? "clause" : "clauses"}
            {" \u00b7 "}
            {formatRelativeDate(new Date(createdAt))}
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
