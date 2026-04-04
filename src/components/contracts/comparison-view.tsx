"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskBadge } from "@/components/contracts/risk-badge";
import { ClauseDiff, type DiffType, type Impact } from "@/components/contracts/clause-diff";
import { ArrowRight, Lightbulb } from "lucide-react";

interface ClauseDiffData {
  id: string;
  title: string | null;
  diffType: DiffType | null;
  impact: Impact | null;
  description: string | null;
  recommendation: string | null;
  sortOrder: number | null;
}

interface ComparisonSummary {
  overall_assessment?: string;
  recommendation?: string;
  risk_delta?: { before: number; after: number } | null;
}

export interface ComparisonViewProps {
  contractAName: string | null;
  contractBName: string | null;
  summary: ComparisonSummary | null;
  clauseDiffs: ClauseDiffData[];
}

function countByImpact(diffs: ClauseDiffData[], impact: Impact): number {
  return diffs.filter((d) => d.impact === impact).length;
}

export function ComparisonView({ contractAName, contractBName, summary, clauseDiffs }: ComparisonViewProps) {
  const negativeCount = countByImpact(clauseDiffs, "negative");
  const neutralCount = countByImpact(clauseDiffs, "neutral");
  const positiveCount = countByImpact(clauseDiffs, "positive");

  const parsed = summary as ComparisonSummary | null;
  const riskBefore = parsed?.risk_delta?.before ?? null;
  const riskAfter = parsed?.risk_delta?.after ?? null;

  // Sort: negative first, then neutral, then positive
  const sorted = [...clauseDiffs].sort((a, b) => {
    const order: Record<string, number> = { negative: 0, neutral: 1, positive: 2 };
    const aOrder = a.impact ? (order[a.impact] ?? 1) : 1;
    const bOrder = b.impact ? (order[b.impact] ?? 1) : 1;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  return (
    <div className="space-y-6">
      {/* Header: risk delta + severity counts */}
      <div className="flex flex-wrap items-center gap-6">
        {(riskBefore !== null || riskAfter !== null) && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {contractAName ?? "Contract A"}
            </span>
            <RiskBadge score={riskBefore ?? null} size="md" />
            <ArrowRight className="size-4 text-muted-foreground" />
            <RiskBadge score={riskAfter ?? null} size="md" />
            <span className="text-sm text-muted-foreground">
              {contractBName ?? "Contract B"}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          {negativeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400">
              {negativeCount} Negative
            </span>
          )}
          {neutralCount > 0 && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-yellow-600 dark:text-yellow-400">
              {neutralCount} Neutral
            </span>
          )}
          {positiveCount > 0 && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400">
              {positiveCount} Positive
            </span>
          )}
        </div>
      </div>

      {/* Summary card */}
      {parsed && (parsed.overall_assessment || parsed.recommendation) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="size-4" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {parsed.overall_assessment && (
              <p className="text-sm text-foreground">{parsed.overall_assessment}</p>
            )}
            {parsed.recommendation && (
              <div className="rounded-md bg-purple-50 p-3 dark:bg-purple-950/30">
                <p className="text-sm text-purple-700 dark:text-purple-300">
                  {parsed.recommendation}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Feed */}
      <div className="space-y-3">
        {sorted.map((diff) => (
          <ClauseDiff
            key={diff.id}
            title={diff.title}
            diffType={diff.diffType}
            impact={diff.impact}
            description={diff.description}
            recommendation={diff.recommendation}
          />
        ))}
        {sorted.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No differences found between the contracts.
          </p>
        )}
      </div>
    </div>
  );
}
