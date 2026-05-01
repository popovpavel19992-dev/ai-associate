import type { DemandClaimType } from "@/server/db/schema/case-demand-letters";
import type { DemandLetterSectionKey } from "@/server/db/schema/case-demand-letter-sections";

export type { DemandClaimType, DemandLetterSectionKey };

export interface ClassifyResult {
  claimType: DemandClaimType;
  confidence: number;
  rationale: string;
  ranked: Array<{ claimType: DemandClaimType; confidence: number }>;
}

export interface SourceExcerpt {
  documentId: string | null;
  title: string;
  snippet: string;
  score: number;
}

export interface StatuteExcerpt {
  citation: string;
  jurisdiction: string;
  text: string;
}

export interface DraftSectionContext {
  claimType: DemandClaimType;
  caseTitle: string;
  recipientName: string;
  demandAmountCents: number;
  deadlineDate: string;
  summary: string;
  caseExcerpts: SourceExcerpt[];
  statutes: StatuteExcerpt[];
}
