export type CiteType = "opinion" | "statute";

export type CiteStatus =
  | "good_law"
  | "caution"
  | "overruled"
  | "unverified"
  | "not_found"
  | "pending"
  | "malformed";

export interface ExtractedCitation {
  raw: string;
  type: CiteType;
}

export interface CiteCheckCitation {
  raw: string;
  citeKey: string;
  type: CiteType;
  status: CiteStatus;
  summary: string | null;
  signals: {
    citedByCount?: number;
    treatmentNotes?: string[];
    cachedOpinionId?: string;
  } | null;
  location: {
    sectionKey: "facts" | "argument" | "conclusion";
    offset: number;
  };
}

export interface CiteCheckResult {
  runAt: string;
  totalCites: number;
  pendingCites: number;
  citations: CiteCheckCitation[];
  creditsCharged: number;
}

export interface TreatmentDecision {
  status: Exclude<CiteStatus, "pending">;
  summary: string | null;
  signals: CiteCheckCitation["signals"];
}
