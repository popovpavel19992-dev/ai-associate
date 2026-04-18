export interface UscSectionResult {
  source: "usc";             // discriminator — set by client on every result
  title: number;
  section: string;
  heading: string;
  bodyText: string;          // "" when only metadata resolved; fill via fetchBody()
  effectiveDate?: string;    // ISO; from granule lastModified or dateIssued
  citationBluebook: string;  // e.g. "42 U.S.C. § 1983"
  granuleId: string;         // stable GovInfo ID — cache key
  packageId: string;         // e.g. "USCODE-2023-title42"
  metadata?: {
    url?: string;
    parentTitleHeading?: string;
  };
}

export class GovInfoError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GovInfoError";
  }
}
