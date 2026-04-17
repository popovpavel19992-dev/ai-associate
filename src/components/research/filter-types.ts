// src/components/research/filter-types.ts
//
// Shared types and display labels for the research filters UI.
// Mirrors the shape of FiltersSchema in src/server/trpc/routers/research.ts.

export type Jurisdiction = "federal" | "ca" | "ny" | "tx" | "fl" | "il";
export type CourtLevel =
  | "scotus"
  | "circuit"
  | "district"
  | "state_supreme"
  | "state_appellate";

export interface ResearchFilters {
  jurisdictions?: Jurisdiction[];
  courtLevels?: CourtLevel[];
  fromYear?: number;
  toYear?: number;
  courtName?: string;
}

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  federal: "Federal",
  ca: "California",
  ny: "New York",
  tx: "Texas",
  fl: "Florida",
  il: "Illinois",
};

export const COURT_LEVEL_LABELS: Record<CourtLevel, string> = {
  scotus: "SCOTUS",
  circuit: "Circuit",
  district: "District",
  state_supreme: "State Supreme",
  state_appellate: "State Appellate",
};

export const ALL_JURISDICTIONS: Jurisdiction[] = [
  "federal",
  "ca",
  "ny",
  "tx",
  "fl",
  "il",
];

export const ALL_COURT_LEVELS: CourtLevel[] = [
  "scotus",
  "circuit",
  "district",
  "state_supreme",
  "state_appellate",
];
