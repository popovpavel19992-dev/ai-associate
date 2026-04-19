import { describe, it, expect, vi, beforeEach } from "vitest";
import { CourtListenerClient } from "@/server/services/courtlistener/client";

describe("CourtListenerClient", () => {
  let client: CourtListenerClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new CourtListenerClient({
      apiToken: "test-token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
  });

  it("builds search URL with query and jurisdiction filter", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ count: 0, results: [] }),
    });

    await client.search({
      query: "arbitration clause",
      filters: { jurisdictions: ["ca", "ny"] },
      page: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/rest/v4/search/");
    expect(url).toContain("type=o");
    expect(url).toContain("q=arbitration+clause");
    expect(url).toContain("court=cal%2Ccalctapp%2Cny%2Cnyappdiv");
    expect(init.headers.Authorization).toBe("Token test-token");
  });

  it("normalizes search response to OpinionSearchHit[]", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        count: 1,
        results: [
          {
            cluster_id: 12345,
            caseName: "Smith v. Jones",
            court: "Court of Appeals for the Ninth Circuit",
            court_id: "ca9",
            court_type: "F",
            dateFiled: "2020-03-15",
            citation: ["987 F.3d 456"],
            snippet: "This case addresses ...",
          },
        ],
      }),
    });

    const resp = await client.search({ query: "test" });
    expect(resp.hits).toHaveLength(1);
    expect(resp.hits[0].courtlistenerId).toBe(12345);
    expect(resp.hits[0].caseName).toBe("Smith v. Jones");
    expect(resp.hits[0].citationBluebook).toBe("987 F.3d 456");
    expect(resp.hits[0].jurisdiction).toBe("federal");
    expect(resp.hits[0].courtLevel).toBe("circuit");
  });

  it("retries on 5xx and succeeds on second attempt", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ count: 0, results: [] }) });

    const resp = await client.search({ query: "x" });
    expect(resp.hits).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws RateLimitError on 429", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(client.search({ query: "x" })).rejects.toThrow(/rate limit/i);
  });

  it("fetches opinion detail by courtlistener id", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        cluster_id: 12345,
        caseName: "Smith v. Jones",
        court: "https://www.courtlistener.com/api/rest/v4/courts/ca9/",
        court_type: "F",
        dateFiled: "2020-03-15",
        citation: ["987 F.3d 456"],
        plain_text: "Full opinion text here...",
        judges: "Smith, Jones, Doe",
      }),
    });

    const op = await client.getOpinion(12345);
    expect(op.fullText).toBe("Full opinion text here...");
    expect(op.judges).toEqual(["Smith", "Jones", "Doe"]);
  });

  it("buckets unmapped state-court hits into 'other' / 'state_other'", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        count: 2,
        results: [
          {
            cluster_id: 555,
            caseName: "Doe v. Arizona",
            court: "Arizona Court of Appeals",
            court_id: "arizctapp",
            dateFiled: "2022-01-10",
            citation: ["250 Ariz. 1"],
            snippet: "...",
          },
          {
            cluster_id: 777,
            caseName: "State v. Roe",
            court: "Some Brand-New Court",
            court_id: "brandnewct", // not in COURT_MAP and not in STATE_OTHER_COURTS
            dateFiled: "2023-06-01",
            citation: ["1 Brand 1"],
            snippet: "...",
          },
        ],
      }),
    });

    const resp = await client.search({ query: "x" });
    expect(resp.hits).toHaveLength(2);
    for (const hit of resp.hits) {
      expect(hit.jurisdiction).toBe("other");
      expect(hit.courtLevel).toBe("state_other");
    }
  });

  it("drops hits with empty court slug", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        count: 1,
        results: [
          {
            cluster_id: 999,
            caseName: "Mystery v. Unknown",
            court_id: "",
            dateFiled: "2020-01-01",
            citation: [""],
            snippet: "",
          },
        ],
      }),
    });
    const resp = await client.search({ query: "x" });
    expect(resp.hits).toHaveLength(0);
  });

  it("throws CourtListenerError after 3 failed 5xx attempts", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(client.search({ query: "x" })).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
