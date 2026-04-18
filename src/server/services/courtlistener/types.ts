export type Jurisdiction = "federal" | "ca" | "ny" | "tx" | "fl" | "il" | "other";
export type CourtLevel =
  | "scotus"
  | "circuit"
  | "district"
  | "state_supreme"
  | "state_appellate"
  | "state_other";

export interface SearchFilters {
  jurisdictions?: Jurisdiction[];
  /** Reserved for Task 9 router — not yet wired into the CourtListener request. */
  courtLevels?: CourtLevel[];
  fromYear?: number;
  toYear?: number;
  /** Reserved for Task 9 router — not yet wired into the CourtListener request. */
  courtName?: string;
}

export interface SearchParams {
  query: string;
  filters?: SearchFilters;
  page?: number; // 1-indexed
  pageSize?: number; // default 20
}

export interface OpinionSearchHit {
  courtlistenerId: number;
  caseName: string;
  court: string; // court slug, e.g., "ca9"
  jurisdiction: Jurisdiction;
  courtLevel: CourtLevel;
  decisionDate: string; // ISO date
  citationBluebook: string;
  snippet: string;
}

export interface SearchResponse {
  hits: OpinionSearchHit[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface OpinionDetail {
  courtlistenerId: number;
  caseName: string;
  court: string;
  jurisdiction: Jurisdiction;
  courtLevel: CourtLevel;
  decisionDate: string;
  citationBluebook: string;
  fullText: string;
  judges?: string[];
  syllabusUrl?: string;
  citedByCount?: number;
}
