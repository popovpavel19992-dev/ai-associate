/**
 * ADR: eCFR endpoint verification
 *
 * Verified: 2026-04-18
 * Docs consulted:
 *   - https://www.ecfr.gov/developers/documentation/api/v1 (interactive docs; redirects to
 *     federalregister.gov unblock page for WebFetch — content verified via Microsoft Learn
 *     eCFR connector mirror)
 *   - https://learn.microsoft.com/en-us/connectors/ecfr/ (OpenAPI-derived endpoint + schema mirror)
 *   - https://www.ecfr.gov/api/versioner/v1/structure/2022-03-08/title-13.json (confirmed live
 *     structure endpoint URL shape in search results)
 *
 * Confirmed endpoints (NO API key required — free public API):
 *   - GET /api/search/v1/results?query=<q>&per_page=<n>
 *       → { results: [{ hierarchy: { title, section, ... }, headings: { section, ... },
 *                        hierarchy_headings: {...}, full_text_excerpt, starts_on, ends_on,
 *                        type, score, structure_index }],
 *           meta: { current_page, total_pages, total_count, max_score, description } }
 *   - GET /api/versioner/v1/structure/{YYYY-MM-DD}/title-{n}.json
 *       → nested tree: each node has { type, label, label_level, label_description,
 *           identifier, reserved, children: [...] }. Leaf nodes where type === "section"
 *           carry identifier like "35.104".
 *   - GET /api/versioner/v1/full/{YYYY-MM-DD}/title-{n}.xml  (XML full content; fallback/not used in MVP)
 *
 * MVP choices:
 *   - bodyText left empty ("") on lookupCfrSection — structure endpoint returns headings only.
 *     Full body would require the XML endpoint + DOM traversal; deferred. Same pattern as
 *     GovInfoClient.lookupUscSection.
 *   - Single-request structure fetch (no pagination). Large titles (e.g., Title 40) return
 *     in one JSON payload per eCFR design; no size issues observed in MVP.
 *   - Section input guarded with /^[\w.-]+$/ (same guard as GovInfoClient) — CFR sections
 *     look like "35.104" or "170.215"; the guard rejects injection attempts.
 *
 * Deviations from plan sketch: none material. Confirmed search path `/api/search/v1/results`
 * and structure path `/api/versioner/v1/structure/{date}/title-{n}.json` exactly as planned.
 */

import type { CfrSectionResult } from "./types";
import { EcfrError } from "./types";

export { EcfrError } from "./types";

const BASE_URL = "https://www.ecfr.gov/api";
const DEFAULT_RETRIES = 3;

interface StructureNode {
  type?: string;
  label?: string;
  label_description?: string;
  identifier?: string;
  reserved?: boolean;
  children?: StructureNode[];
}

export class EcfrClient {
  constructor(private readonly deps?: { fetchImpl?: typeof fetch }) {}

  async lookupCfrSection(
    title: number,
    section: string,
  ): Promise<CfrSectionResult | null> {
    if (!/^[\w.-]+$/.test(section)) {
      throw new RangeError(`Invalid CFR section: ${section}`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const url = `${BASE_URL}/versioner/v1/structure/${today}/title-${title}.json`;
    const res = await this.fetchWithRetry(url);
    if (res.status === 404) return null;
    if (!res.ok)
      throw new EcfrError(`CFR lookup failed: ${res.status}`, res.status);
    const raw = (await res.json()) as StructureNode;
    return this.extractSection(title, section, raw);
  }

  async searchCfr(query: string, limit = 5): Promise<CfrSectionResult[]> {
    const url = new URL(`${BASE_URL}/search/v1/results`);
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(limit));
    const res = await this.fetchWithRetry(url.toString());
    if (!res.ok)
      throw new EcfrError(`CFR search failed: ${res.status}`, res.status);
    const raw = (await res.json()) as { results?: unknown[] };
    return (raw.results ?? [])
      .flatMap((r) => {
        const hit = this.normalizeSearchHit(r);
        return hit ? [hit] : [];
      })
      .slice(0, limit);
  }

  private extractSection(
    title: number,
    section: string,
    raw: StructureNode,
  ): CfrSectionResult | null {
    let parentTitleHeading: string | undefined;
    if (raw.type === "title") {
      parentTitleHeading = raw.label_description ?? raw.label;
    }

    const match = this.findSection(raw, section);
    if (!match) return null;

    const heading =
      match.label_description ?? match.label ?? `§ ${section}`;
    return {
      source: "cfr",
      title,
      section,
      heading,
      bodyText: "",
      citationBluebook: `${title} C.F.R. § ${section}`,
      metadata: {
        url: `https://www.ecfr.gov/current/title-${title}/section-${section}`,
        parentTitleHeading,
      },
    };
  }

  private findSection(
    node: StructureNode,
    section: string,
  ): StructureNode | null {
    if (node.type === "section" && node.identifier === section) {
      return node;
    }
    if (!node.children) return null;
    for (const child of node.children) {
      const hit = this.findSection(child, section);
      if (hit) return hit;
    }
    return null;
  }

  private normalizeSearchHit(raw: unknown): CfrSectionResult | null {
    const r = raw as {
      hierarchy?: { title?: string | number; section?: string };
      headings?: { section?: string };
      hierarchy_headings?: { title?: string };
      full_text_excerpt?: string;
      starts_on?: string;
      type?: string;
    };
    const titleRaw = r.hierarchy?.title;
    const section = r.hierarchy?.section;
    if (titleRaw === undefined || !section) return null;
    const title = Number(titleRaw);
    if (!Number.isFinite(title)) return null;

    return {
      source: "cfr",
      title,
      section,
      heading: r.headings?.section ?? "",
      bodyText: r.full_text_excerpt ?? "",
      effectiveDate: r.starts_on,
      citationBluebook: `${title} C.F.R. § ${section}`,
      metadata: {
        url: `https://www.ecfr.gov/current/title-${title}/section-${section}`,
        parentTitleHeading: r.hierarchy_headings?.title,
      },
    };
  }

  private async fetchWithRetry(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const fetchImpl = this.deps?.fetchImpl ?? fetch;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < DEFAULT_RETRIES; attempt++) {
      try {
        const res = await fetchImpl(url, init);
        if (res.status >= 500 || res.status === 429) {
          lastError = new EcfrError(`retryable: ${res.status}`, res.status);
          if (attempt < DEFAULT_RETRIES - 1)
            await this.sleep(100 * Math.pow(2, attempt));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < DEFAULT_RETRIES - 1)
          await this.sleep(100 * Math.pow(2, attempt));
      }
    }
    throw lastError ?? new EcfrError("retry exhausted");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
