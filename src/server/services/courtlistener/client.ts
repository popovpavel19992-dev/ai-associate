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
const COURT_MAP: Record<string, { jurisdiction: Jurisdiction; level: CourtLevel }> = {
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

// Known state-court slugs that bucket into the catch-all "other" jurisdiction.
// Listed explicitly so logs show "we know this court exists, just not first-class"
// rather than the generic unmapped warning. Promote to first-class above when a
// jurisdiction earns its own filter chip.
const STATE_OTHER_COURTS: ReadonlySet<string> = new Set([
  // Top-volume states beyond CA/NY/TX/FL/IL
  "pa", "pasuperct", "pacommwct",
  "ohio", "ohioctapp",
  "mass", "massappct",
  "nj", "njsuperctappdiv",
  "wash", "washctapp",
  "ga", "gactapp",
  "mich", "michctapp",
  "nc", "ncctapp",
  "va", "vactapp",
  "ariz", "arizctapp",
  "colo", "coloctapp",
  "iowa", "iowactapp",
  "minn", "minnctapp",
  "wis", "wisctapp",
  "mo", "moctapp",
  "tenn", "tennctapp",
  "ind", "indctapp",
  "or", "orctapp",
  "md", "mdctspecapp",
  "conn", "connappct",
  "nev",
  "utah", "utahctapp",
  "kan", "kanctapp",
  "ky", "kyctapp",
  "ala", "alactapp",
  "sc", "scctapp",
  "okla", "oklactapp",
  "ark", "arkctapp",
  "miss", "missctapp",
  "la", "lactapp",
  "haw", "hawctapp",
  "alaska", "alaskactapp",
  "me",
  "nh",
  "vt",
  "ri",
  "del",
  "mont",
  "idaho", "idahoctapp",
  "wyo",
  "nd",
  "sd",
  "neb", "nebctapp",
  "nm", "nmctapp",
  "wva",
  "dc", "dcctapp",
]);

// Derived from COURT_MAP to prevent drift between the two tables.
const JURISDICTION_COURTS: Record<Jurisdiction, string[]> = Object.entries(COURT_MAP).reduce(
  (acc, [slug, { jurisdiction }]) => {
    (acc[jurisdiction] ??= []).push(slug);
    return acc;
  },
  { federal: [], ca: [], ny: [], tx: [], fl: [], il: [], other: [] } as Record<Jurisdiction, string[]>,
);
// "other" jurisdiction maps to the catch-all state-court slugs above.
JURISDICTION_COURTS.other = Array.from(STATE_OTHER_COURTS);

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
      hits: (raw.results ?? []).flatMap((r: any) => {
        const hit = this.normalizeHit(r);
        if (!hit) {
          console.warn(`[CourtListener] missing court slug on result ${r.id ?? r.cluster_id ?? "?"}; dropping`);
          return [];
        }
        return [hit];
      }) as OpinionSearchHit[],
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
    // CourtListener v4 search: `court_id` is the slug ("scotus"), `court` is the display name.
    // Opinion detail endpoint sometimes returns only `court` as a resource URL (e.g. ".../courts/scotus/") —
    // derive the slug from the trailing path segment as a fallback.
    let courtSlug: string = r.court_id ?? "";
    if (!courtSlug && typeof r.court === "string" && r.court.includes("/")) {
      const m = r.court.match(/\/courts\/([^/]+)\/?$/);
      if (m) courtSlug = m[1];
    }
    const mapping: { jurisdiction: Jurisdiction; level: CourtLevel } | null =
      COURT_MAP[courtSlug] ??
      (courtSlug ? { jurisdiction: "other", level: "state_other" } : null);
    if (!mapping) return null;
    // v4 opinion search returns `cluster_id` (the stable legal identifier); detail endpoint uses `id`.
    // Fall back cluster_id → id → opinions[0].id to cover both shapes.
    const courtlistenerId =
      r.cluster_id ?? r.id ?? (Array.isArray(r.opinions) ? r.opinions[0]?.id : undefined);
    if (typeof courtlistenerId !== "number") return null;
    const citation = Array.isArray(r.citation) ? r.citation[0] : r.citation;
    return {
      courtlistenerId,
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
