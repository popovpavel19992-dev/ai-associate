/**
 * ADR: GovInfo USC endpoint verification
 *
 * Verified: 2026-04-18
 * Docs consulted:
 *   - https://api.govinfo.gov/docs/ (interactive portal; JS-only, returned minimal scraped content)
 *   - https://www.govinfo.gov/features/search-service-overview (confirmed Search Service fields)
 *   - https://github.com/usgpo/api (fallback; confirmed endpoint shapes)
 *
 * Confirmed endpoints:
 *   - POST /search            body: { query, pageSize, sorts: [{ field, sortOrder }] }
 *   - GET  /packages/{pkgId}/granules/{granuleId}/summary
 *   - GET  /packages/{pkgId}/granules/{granuleId}/htm
 *
 * Confirmed response fields used by normalizeSearchHit:
 *   granuleId, packageId, title, lastModified, resultLink
 *   (dateIssued also available; we prefer lastModified per sketch)
 *
 * USC granule-ID regex verified: /^USCODE-\d+-title(\d+)-.*-sec([\w.-]+)$/
 *   Pattern: USCODE-{year}-title{N}-chap{...}-subchap{...}-sec{S}
 *
 * Deviations from sketch: none. Field names match.
 */

import type { UscSectionResult } from "./types";
import { GovInfoError } from "./types";

export { GovInfoError } from "./types";

const BASE_URL = "https://api.govinfo.gov";
const DEFAULT_RETRIES = 3;

const GRANULE_RE = /^USCODE-\d+-title(\d+)-.*-sec([\w.-]+)$/;

export class GovInfoClient {
  constructor(private readonly deps: { apiKey: string; fetchImpl?: typeof fetch }) {}

  async lookupUscSection(title: number, section: string): Promise<UscSectionResult | null> {
    if (!/^[\w.-]+$/.test(section)) {
      throw new RangeError(`Invalid USC section: ${section}`);
    }
    // Live API rejects `uscodetitlenumber:N` filter with 500. Bare-token search
    // returns matches across titles; filter to exact (title, section) client-side
    // via the granule-ID regex populated by normalizeSearchHit. Request a small
    // page to keep latency low; pick the first matching hit.
    const query = `collection:USCODE AND ${section}`;
    const hits = await this.search(query, 10);
    return hits.find((h) => h.title === title && h.section === section) ?? null;
  }

  async searchUsc(query: string, limit = 5): Promise<UscSectionResult[]> {
    return this.search(`collection:USCODE AND (${query})`, limit);
  }

  async fetchBody(granuleId: string, packageId: string): Promise<string> {
    const url = new URL(`${BASE_URL}/packages/${packageId}/granules/${granuleId}/htm`);
    url.searchParams.set("api_key", this.deps.apiKey);
    const res = await this.fetchWithRetry(url.toString());
    if (!res.ok) throw new GovInfoError(`USC body fetch failed: ${res.status}`, res.status);
    return await res.text();
  }

  private async search(query: string, pageSize: number): Promise<UscSectionResult[]> {
    const url = new URL(`${BASE_URL}/search`);
    url.searchParams.set("api_key", this.deps.apiKey);
    const res = await this.fetchWithRetry(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        pageSize,
        offsetMark: "*", // required by live API on the first page
        sorts: [{ field: "relevancy", sortOrder: "DESC" }],
      }),
    });
    if (!res.ok) throw new GovInfoError(`USC search failed: ${res.status}`, res.status);
    const raw = (await res.json()) as { results?: unknown[] };
    return (raw.results ?? []).flatMap((r) => {
      const hit = this.normalizeSearchHit(r);
      return hit ? [hit] : [];
    });
  }

  private normalizeSearchHit(raw: unknown): UscSectionResult | null {
    const r = raw as Record<string, unknown>;
    const granuleId = String(r.granuleId ?? "");
    const packageId = String(r.packageId ?? "");
    const m = GRANULE_RE.exec(granuleId);
    if (!m) return null;
    const title = Number(m[1]);
    const section = m[2];
    return {
      source: "usc",
      title,
      section,
      heading: String(r.title ?? ""),
      bodyText: "",
      effectiveDate: r.lastModified ? String(r.lastModified) : undefined,
      citationBluebook: `${title} U.S.C. § ${section}`,
      granuleId,
      packageId,
      metadata: { url: r.resultLink ? String(r.resultLink) : undefined },
    };
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < DEFAULT_RETRIES; attempt++) {
      try {
        const res = await fetchImpl(url, init);
        if (res.status >= 500 || res.status === 429) {
          lastError = new GovInfoError(`retryable: ${res.status}`, res.status);
          if (attempt < DEFAULT_RETRIES - 1) await this.sleep(100 * Math.pow(2, attempt));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < DEFAULT_RETRIES - 1) await this.sleep(100 * Math.pow(2, attempt));
      }
    }
    throw lastError ?? new GovInfoError("retry exhausted");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
