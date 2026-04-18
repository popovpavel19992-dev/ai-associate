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
