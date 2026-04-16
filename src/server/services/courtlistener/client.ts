import type {
  Jurisdiction,
  CourtLevel,
  SearchParams,
  SearchResponse,
  OpinionSearchHit,
  OpinionDetail,
} from "./types";

const BASE_URL = "https://www.courtlistener.com";

// Court slug → our jurisdiction/level mapping. Extend as CourtListener adds more.
const COURT_MAP: Record<string, { jurisdiction: Jurisdiction; level: CourtLevel; reporterPrefix?: string }> = {
  scotus: { jurisdiction: "federal", level: "scotus" },
  ca1: { jurisdiction: "federal", level: "circuit" },
  ca2: { jurisdiction: "federal", level: "circuit" },
  ca3: { jurisdiction: "federal", level: "circuit" },
  ca4: { jurisdiction: "federal", level: "circuit" },
  ca5: { jurisdiction: "federal", level: "circuit" },
  ca6: { jurisdiction: "federal", level: "circuit" },
  ca7: { jurisdiction: "federal", level: "circuit" },
  ca8: { jurisdiction: "federal", level: "circuit" },
  ca9: { jurisdiction: "federal", level: "circuit" },
  ca10: { jurisdiction: "federal", level: "circuit" },
  ca11: { jurisdiction: "federal", level: "circuit" },
  cadc: { jurisdiction: "federal", level: "circuit" },
  cafc: { jurisdiction: "federal", level: "circuit" },
  cal: { jurisdiction: "ca", level: "state_supreme" },
  calctapp: { jurisdiction: "ca", level: "state_appellate" },
  ny: { jurisdiction: "ny", level: "state_supreme" },
  nyappdiv: { jurisdiction: "ny", level: "state_appellate" },
  tex: { jurisdiction: "tx", level: "state_supreme" },
  texapp: { jurisdiction: "tx", level: "state_appellate" },
  fla: { jurisdiction: "fl", level: "state_supreme" },
  fladistctapp: { jurisdiction: "fl", level: "state_appellate" },
  ill: { jurisdiction: "il", level: "state_supreme" },
  illappct: { jurisdiction: "il", level: "state_appellate" },
};

// Courts that a jurisdiction filter should map to (for the `court=` query param).
const JURISDICTION_COURTS: Record<Jurisdiction, string[]> = {
  federal: ["scotus", "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"],
  ca: ["cal", "calctapp"],
  ny: ["ny", "nyappdiv"],
  tx: ["tex", "texapp"],
  fl: ["fla", "fladistctapp"],
  il: ["ill", "illappct"],
};

export class CourtListenerRateLimitError extends Error {
  constructor() {
    super("CourtListener rate limit exceeded");
    this.name = "CourtListenerRateLimitError";
  }
}

export class CourtListenerError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "CourtListenerError";
  }
}

export interface CourtListenerClientOptions {
  apiToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class CourtListenerClient {
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: CourtListenerClientOptions) {
    this.apiToken = opts.apiToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = this.buildSearchUrl(params);
    const raw = await this.requestJson<any>(url);
    return {
      hits: (raw.results ?? []).map((r: any) => this.normalizeHit(r)).filter(Boolean) as OpinionSearchHit[],
      totalCount: raw.count ?? 0,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    };
  }

  async getOpinion(courtlistenerId: number): Promise<OpinionDetail> {
    const url = `${this.baseUrl}/api/rest/v4/opinions/${courtlistenerId}/`;
    const raw = await this.requestJson<any>(url);
    const normalized = this.normalizeHit(raw);
    if (!normalized) throw new CourtListenerError(`Unmappable opinion ${courtlistenerId}`);
    return {
      ...normalized,
      fullText: raw.plain_text ?? raw.html_with_citations ?? "",
      judges: raw.judges ? String(raw.judges).split(",").map((j: string) => j.trim()).filter(Boolean) : [],
      syllabusUrl: raw.syllabus_url,
      citedByCount: raw.citation_count,
    };
  }

  private buildSearchUrl(params: SearchParams): string {
    const sp = new URLSearchParams();
    sp.set("type", "o");
    sp.set("q", params.query);
    sp.set("page", String(params.page ?? 1));
    sp.set("page_size", String(params.pageSize ?? 20));

    if (params.filters?.jurisdictions?.length) {
      const courts = params.filters.jurisdictions
        .flatMap((j) => JURISDICTION_COURTS[j] ?? [])
        .join(",");
      if (courts) sp.set("court", courts);
    }
    if (params.filters?.fromYear) sp.set("filed_after", `${params.filters.fromYear}-01-01`);
    if (params.filters?.toYear) sp.set("filed_before", `${params.filters.toYear}-12-31`);

    return `${this.baseUrl}/api/rest/v4/search/?${sp.toString()}`;
  }

  private normalizeHit(r: any): OpinionSearchHit | null {
    const courtSlug: string = r.court ?? "";
    const mapping = COURT_MAP[courtSlug];
    if (!mapping) return null;
    const citation = Array.isArray(r.citation) ? r.citation[0] : r.citation;
    return {
      courtlistenerId: r.id,
      caseName: r.caseName ?? r.case_name ?? "Unknown case",
      court: courtSlug,
      jurisdiction: mapping.jurisdiction,
      courtLevel: mapping.level,
      decisionDate: r.dateFiled ?? r.date_filed,
      citationBluebook: citation ?? "",
      snippet: r.snippet ?? "",
    };
  }

  private async requestJson<T>(url: string, attempt = 0): Promise<T> {
    const resp = await this.fetchImpl(url, {
      headers: { Authorization: `Token ${this.apiToken}`, Accept: "application/json" },
    });
    if (resp.status === 429) throw new CourtListenerRateLimitError();
    if (resp.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      return this.requestJson<T>(url, attempt + 1);
    }
    if (!resp.ok) {
      throw new CourtListenerError(`CourtListener ${resp.status}`, resp.status);
    }
    return (await resp.json()) as T;
  }
}
