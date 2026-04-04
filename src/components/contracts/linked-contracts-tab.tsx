"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { RiskBadge } from "./risk-badge";
import { CONTRACT_TYPE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface LinkedContract {
  id: string;
  name: string;
  status: string;
  riskScore: number | null;
  detectedContractType: string | null;
  createdAt: Date;
}

interface LinkedContractsTabProps {
  linkedContracts: LinkedContract[];
  caseId: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  uploading: "secondary",
  extracting: "secondary",
  analyzing: "secondary",
  ready: "default",
  failed: "destructive",
};

export function LinkedContractsTab({ linkedContracts, caseId }: LinkedContractsTabProps) {
  if (linkedContracts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 py-16 dark:border-zinc-700">
        <p className="text-lg font-medium text-zinc-600 dark:text-zinc-400">
          No linked contracts
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Upload a contract to link it to this case.
        </p>
        <Link
          href={`/contracts/new?caseId=${caseId}`}
          className={cn(buttonVariants(), "mt-6")}
        >
          <Plus className="mr-2 h-4 w-4" />
          Review Contract
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {linkedContracts.map((contract) => (
        <Link key={contract.id} href={`/contracts/${contract.id}`}>
          <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50">
            <RiskBadge score={contract.riskScore} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{contract.name}</p>
              <p className="text-xs text-muted-foreground">
                {contract.detectedContractType
                  ? (CONTRACT_TYPE_LABELS[contract.detectedContractType] ?? contract.detectedContractType)
                  : "Unknown type"}
                {" \u00b7 "}
                {new Date(contract.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[contract.status] ?? "outline"}>
              {contract.status}
            </Badge>
          </Card>
        </Link>
      ))}
    </div>
  );
}
