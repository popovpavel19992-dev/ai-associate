"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RiskBadge } from "./risk-badge";
import { KeyTermsGrid } from "./key-terms-grid";
import { ClauseList } from "./clause-list";
import { RedFlagsPanel } from "./red-flags-panel";
import { MissingClauses } from "./missing-clauses";
import { NegotiationPoints } from "./negotiation-points";
import type { ContractAnalysisOutput } from "@/lib/schemas";

interface ClauseData {
  id: string;
  clauseNumber: string | null;
  title: string | null;
  originalText: string | null;
  clauseType: string | null;
  riskLevel: string | null;
  summary: string | null;
  annotation: string | null;
  suggestedEdit: string | null;
}

interface ContractAnalysisProps {
  contract: {
    analysisSections: unknown;
    riskScore: number | null;
    clauses: ClauseData[];
  };
  selectedClauseId: string | null;
  onSelectClause: (id: string) => void;
}

export function ContractAnalysis({
  contract,
  selectedClauseId,
  onSelectClause,
}: ContractAnalysisProps) {
  const analysis = contract.analysisSections as ContractAnalysisOutput | null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <RiskBadge score={contract.riskScore} size="lg" />
        <div>
          <p className="text-sm font-medium">Contract Analysis</p>
          <p className="text-xs text-muted-foreground">
            {contract.riskScore !== null
              ? `Risk score: ${contract.riskScore}/10`
              : "No risk score available"}
          </p>
        </div>
      </div>

      <Tabs defaultValue="summary" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="shrink-0 justify-start overflow-x-auto border-b px-4">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="key-terms">Key Terms</TabsTrigger>
          <TabsTrigger value="clauses">Clauses</TabsTrigger>
          <TabsTrigger value="red-flags">Red Flags</TabsTrigger>
          <TabsTrigger value="missing">Missing</TabsTrigger>
          <TabsTrigger value="negotiate">Negotiate</TabsTrigger>
          <TabsTrigger value="law">Law</TabsTrigger>
          <TabsTrigger value="glossary">Glossary</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <div className="p-4">
            {/* Summary */}
            <TabsContent value="summary" className="mt-0">
              {analysis?.executive_summary ? (
                <div className="space-y-4">
                  <Card className="p-4 space-y-3">
                    <h3 className="text-sm font-semibold">Executive Summary</h3>
                    <div className="grid gap-2 text-sm">
                      <div className="flex gap-2">
                        <span className="font-medium text-muted-foreground">Type:</span>
                        <span>{analysis.executive_summary.contract_type}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="font-medium text-muted-foreground">Purpose:</span>
                        <span>{analysis.executive_summary.purpose}</span>
                      </div>
                      {analysis.executive_summary.effective_date && (
                        <div className="flex gap-2">
                          <span className="font-medium text-muted-foreground">Effective Date:</span>
                          <span>{analysis.executive_summary.effective_date}</span>
                        </div>
                      )}
                    </div>
                    {analysis.executive_summary.parties.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Parties</p>
                          <div className="flex flex-wrap gap-2">
                            {analysis.executive_summary.parties.map((p, i) => (
                              <Badge key={i} variant="secondary">
                                {p.name} ({p.role})
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </Card>

                  {analysis.risk_assessment && (
                    <Card className="p-4 space-y-3">
                      <h3 className="text-sm font-semibold">Risk Assessment</h3>
                      <div className="flex items-center gap-2">
                        <RiskBadge score={analysis.risk_assessment.score} size="sm" />
                        <span className="text-sm">
                          Score: {analysis.risk_assessment.score}/10
                        </span>
                      </div>
                      {analysis.risk_assessment.factors.length > 0 && (
                        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                          {analysis.risk_assessment.factors.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  )}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No summary available yet.
                </p>
              )}
            </TabsContent>

            {/* Key Terms */}
            <TabsContent value="key-terms" className="mt-0">
              <KeyTermsGrid terms={analysis?.key_terms ?? []} />
            </TabsContent>

            {/* Clauses */}
            <TabsContent value="clauses" className="mt-0">
              <ClauseList
                clauses={contract.clauses}
                selectedClauseId={selectedClauseId}
                onSelectClause={onSelectClause}
              />
            </TabsContent>

            {/* Red Flags */}
            <TabsContent value="red-flags" className="mt-0">
              <RedFlagsPanel redFlags={analysis?.red_flags ?? []} />
            </TabsContent>

            {/* Missing Clauses */}
            <TabsContent value="missing" className="mt-0">
              <MissingClauses missingClauses={analysis?.missing_clauses ?? []} />
            </TabsContent>

            {/* Negotiation Points */}
            <TabsContent value="negotiate" className="mt-0">
              <NegotiationPoints points={analysis?.negotiation_points ?? []} />
            </TabsContent>

            {/* Governing Law */}
            <TabsContent value="law" className="mt-0">
              {analysis?.governing_law ? (
                <Card className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Governing Law</h3>
                  <div className="grid gap-2 text-sm">
                    <div className="flex gap-2">
                      <span className="font-medium text-muted-foreground">Jurisdiction:</span>
                      <span>{analysis.governing_law.jurisdiction}</span>
                    </div>
                    {analysis.governing_law.venue && (
                      <div className="flex gap-2">
                        <span className="font-medium text-muted-foreground">Venue:</span>
                        <span>{analysis.governing_law.venue}</span>
                      </div>
                    )}
                    {analysis.governing_law.dispute_resolution && (
                      <div className="flex gap-2">
                        <span className="font-medium text-muted-foreground">Dispute Resolution:</span>
                        <span>{analysis.governing_law.dispute_resolution}</span>
                      </div>
                    )}
                  </div>
                </Card>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No governing law information available.
                </p>
              )}
            </TabsContent>

            {/* Glossary / Defined Terms */}
            <TabsContent value="glossary" className="mt-0">
              {analysis?.defined_terms && analysis.defined_terms.length > 0 ? (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2 text-left font-medium">Term</th>
                        <th className="px-4 py-2 text-left font-medium">Definition</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.defined_terms.map((dt, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          <td className="px-4 py-2 font-medium">
                            {dt.term}
                            {dt.section_ref && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({dt.section_ref})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{dt.definition}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No defined terms available.
                </p>
              )}
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
