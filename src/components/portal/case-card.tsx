"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  processing: "bg-yellow-100 text-yellow-700",
  ready: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

interface CaseCardProps {
  id: string;
  name: string;
  status: string;
  detectedCaseType: string | null;
  updatedAt: Date;
}

export function CaseCard({ id, name, status, detectedCaseType, updatedAt }: CaseCardProps) {
  return (
    <Link href={`/portal/cases/${id}`}>
      <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{name}</CardTitle>
            <Badge variant="secondary" className={STATUS_COLORS[status]}>
              {status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            {detectedCaseType && <span>{detectedCaseType}</span>}
            <span>Updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
