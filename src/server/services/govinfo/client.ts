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
 * Implementation follows in the next commit.
 */
