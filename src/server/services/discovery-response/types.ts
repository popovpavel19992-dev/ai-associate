import type { OurResponseType } from "@/server/db/schema/our-discovery-response-drafts";
import type { ParsedQuestion } from "@/server/db/schema/incoming-discovery-requests";

export type { OurResponseType, ParsedQuestion };

export interface ResponseDraft {
  responseType: OurResponseType;
  responseText: string | null;
  objectionBasis: string | null;
  aiGenerated: boolean;
}

export interface BatchResult {
  successCount: number;
  failedCount: number;
  creditsCharged: number;
}

export interface CaseCaption {
  plaintiff: string;
  defendant: string;
  caseNumber: string;
  court: string;
}
