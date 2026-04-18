import { describe, it, expect, vi, beforeEach } from "vitest";
import { GovInfoClient, GovInfoError } from "@/server/services/govinfo/client";

function makeFetch(responses: Array<{ status: number; json?: unknown; text?: string }>) {
  const queue = [...responses];
  return vi.fn(async () => {
    const r = queue.shift();
    if (!r) throw new Error("fetch queue exhausted");
    return new Response(r.json ? JSON.stringify(r.json) : r.text ?? "", { status: r.status });
  });
}

describe("GovInfoClient", () => {
  let client: GovInfoClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  const makeClient = (fn: ReturnType<typeof vi.fn>) =>
    new GovInfoClient({
      apiKey: "test-govinfo-key",
      fetchImpl: fn as unknown as typeof fetch,
    });

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("lookupUscSection resolves a single hit and sets source/citation", async () => {
    fetchMock = makeFetch([
      {
        status: 200,
        json: {
          results: [
            {
              granuleId: "USCODE-2023-title42-chap21-subchapI-sec1983",
              packageId: "USCODE-2023-title42",
              title: "Civil action for deprivation of rights",
              lastModified: "2024-01-15T00:00:00Z",
              resultLink: "https://www.govinfo.gov/app/details/USCODE-2023-title42/USCODE-2023-title42-chap21-subchapI-sec1983",
            },
          ],
        },
      },
    ]);
    client = makeClient(fetchMock);

    const res = await client.lookupUscSection(42, "1983");
    expect(res).not.toBeNull();
    expect(res!.source).toBe("usc");
    expect(res!.title).toBe(42);
    expect(res!.section).toBe("1983");
    expect(res!.citationBluebook).toBe("42 U.S.C. § 1983");
    expect(res!.granuleId).toBe("USCODE-2023-title42-chap21-subchapI-sec1983");
    expect(res!.packageId).toBe("USCODE-2023-title42");

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api_key=test-govinfo-key");
    expect(String(url)).toContain("/search");
  });

  it("lookupUscSection returns null on empty results", async () => {
    fetchMock = makeFetch([{ status: 200, json: { results: [] } }]);
    client = makeClient(fetchMock);

    const res = await client.lookupUscSection(42, "9999");
    expect(res).toBeNull();
  });

  it("searchUsc filters non-USCODE granule IDs and normalizes USC hits", async () => {
    fetchMock = makeFetch([
      {
        status: 200,
        json: {
          results: [
            {
              granuleId: "USCODE-2023-title42-chap21-subchapI-sec1983",
              packageId: "USCODE-2023-title42",
              title: "Civil action for deprivation of rights",
              lastModified: "2024-01-15T00:00:00Z",
              resultLink: "https://example.gov/a",
            },
            {
              granuleId: "CFR-2023-title7-vol1-sec1-1",
              packageId: "CFR-2023-title7-vol1",
              title: "not a USC record",
              lastModified: "2024-01-15T00:00:00Z",
            },
            {
              granuleId: "USCODE-2023-title17-chap1-sec107",
              packageId: "USCODE-2023-title17",
              title: "Limitations on exclusive rights: Fair use",
              lastModified: "2024-02-01T00:00:00Z",
            },
          ],
        },
      },
    ]);
    client = makeClient(fetchMock);

    const hits = await client.searchUsc("civil rights", 5);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.source === "usc")).toBe(true);
    expect(hits[0].title).toBe(42);
    expect(hits[0].section).toBe("1983");
    expect(hits[1].title).toBe(17);
    expect(hits[1].section).toBe("107");
  });

  it("fetchBody returns HTML body text with correct URL and api_key", async () => {
    fetchMock = makeFetch([
      { status: 200, text: "<html><body>§ 1983 body</body></html>" },
    ]);
    client = makeClient(fetchMock);

    const body = await client.fetchBody(
      "USCODE-2023-title42-chap21-subchapI-sec1983",
      "USCODE-2023-title42",
    );
    expect(body).toContain("§ 1983 body");

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/packages/USCODE-2023-title42/granules/USCODE-2023-title42-chap21-subchapI-sec1983/htm",
    );
    expect(String(url)).toContain("api_key=test-govinfo-key");
  });

  it("retries on 500 and succeeds on third attempt", async () => {
    fetchMock = makeFetch([
      { status: 500, text: "" },
      { status: 500, text: "" },
      {
        status: 200,
        json: {
          results: [
            {
              granuleId: "USCODE-2023-title42-chap21-subchapI-sec1983",
              packageId: "USCODE-2023-title42",
              title: "heading",
              lastModified: "2024-01-15T00:00:00Z",
            },
          ],
        },
      },
    ]);
    client = makeClient(fetchMock);

    const res = await client.lookupUscSection(42, "1983");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res!.section).toBe("1983");
  });

  it("throws GovInfoError after 3 failed 500 attempts", async () => {
    fetchMock = makeFetch([
      { status: 500, text: "" },
      { status: 500, text: "" },
      { status: 500, text: "" },
    ]);
    client = makeClient(fetchMock);

    const err = await client.lookupUscSection(42, "1983").catch((e) => e);
    expect(err).toBeInstanceOf(GovInfoError);
    expect((err as GovInfoError).status).toBe(500);
    expect((err as Error).name).toBe("GovInfoError");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects section values containing query operators", async () => {
    const client = new GovInfoClient({ apiKey: "test-govinfo-key", fetchImpl: makeFetch([]) as unknown as typeof fetch });
    await expect(client.lookupUscSection(42, "1983 OR collection:CFR")).rejects.toThrow(RangeError);
  });

  it("retries on 429 same as 500", async () => {
    fetchMock = makeFetch([
      { status: 429, text: "" },
      { status: 429, text: "" },
      {
        status: 200,
        json: { results: [] },
      },
    ]);
    client = makeClient(fetchMock);

    const res = await client.lookupUscSection(42, "1983");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res).toBeNull();
  });
});
