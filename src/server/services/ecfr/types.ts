export interface CfrSectionResult {
  source: "cfr"; // discriminator set by client on every result
  title: number;
  section: string;
  heading: string;
  bodyText: string;
  effectiveDate?: string;
  citationBluebook: string; // e.g. "28 C.F.R. § 35.104"
  metadata?: {
    url?: string;
    parentTitleHeading?: string;
  };
}

export class EcfrError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EcfrError";
  }
}
