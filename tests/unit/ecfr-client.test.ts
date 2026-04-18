import { describe, it, expect, vi, beforeEach } from "vitest";
import { EcfrClient, EcfrError } from "@/server/services/ecfr/client";

function makeFetch(
  responses: Array<{ status: number; json?: unknown; text?: string }>,
) {
  const queue = [...responses];
  return vi.fn(async () => {
    const r = queue.shift();
    if (!r) throw new Error("fetch queue exhausted");
    return new Response(r.json ? JSON.stringify(r.json) : r.text ?? "", {
      status: r.status,
    });
  });
}

// Sample eCFR structure JSON: title 28 → chapter I → part 35 → section 35.104
const SAMPLE_STRUCTURE = {
  type: "title",
  label: "Title 28",
  label_description: "Judicial Administration",
  identifier: "28",
  children: [
    {
      type: "chapter",
      label: "Chapter I",
      identifier: "I",
      children: [
        {
          type: "part",
          label: "Part 35",
          label_description: "Nondiscrimination on the Basis of Disability",
          identifier: "35",
          children: [
            {
              type: "section",
              label: "§ 35.104",
              label_description: "Definitions",
              identifier: "35.104",
              reserved: false,
              children: [],
            },
            {
              type: "section",
              label: "§ 35.105",
              label_description: "Self-evaluation",
              identifier: "35.105",
              reserved: false,
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("EcfrClient", () => {
  let client: EcfrClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  const makeClient = (fn: ReturnType<typeof vi.fn>) =>
    new EcfrClient({ fetchImpl: fn as unknown as typeof fetch });

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("lookupCfrSection resolves a matching section and sets source/citation", async () => {
    fetchMock = makeFetch([{ status: 200, json: SAMPLE_STRUCTURE }]);
    client = makeClient(fetchMock);

    const res = await client.lookupCfrSection(28, "35.104");
    expect(res).not.toBeNull();
    expect(res!.source).toBe("cfr");
    expect(res!.title).toBe(28);
    expect(res!.section).toBe("35.104");
    expect(res!.citationBluebook).toBe("28 C.F.R. § 35.104");
    expect(res!.heading).toContain("Definitions");

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/versioner/v1/structure/");
    expect(String(url)).toContain("/title-28.json");
  });

  it("lookupCfrSection returns null when section not found in structure", async () => {
    fetchMock = makeFetch([{ status: 200, json: SAMPLE_STRUCTURE }]);
    client = makeClient(fetchMock);

    const res = await client.lookupCfrSection(28, "99.99");
    expect(res).toBeNull();
  });

  it("lookupCfrSection returns null on 404", async () => {
    fetchMock = makeFetch([{ status: 404, text: "" }]);
    client = makeClient(fetchMock);

    const res = await client.lookupCfrSection(28, "35.104");
    expect(res).toBeNull();
  });

  it("searchCfr normalizes hits, sets source=cfr on all, and respects limit", async () => {
    fetchMock = makeFetch([
      {
        status: 200,
        json: {
          results: [
            {
              hierarchy: { title: "28", section: "35.104" },
              headings: { section: "Definitions" },
              hierarchy_headings: { title: "Judicial Administration" },
              full_text_excerpt: "...accessibility standards apply to...",
              starts_on: "2024-01-01",
              type: "section",
              score: 12.5,
              structure_index: 42,
            },
            {
              hierarchy: { title: "42", section: "12101" },
              headings: { section: "Findings and purpose" },
              hierarchy_headings: { title: "Public Health" },
              full_text_excerpt: "...accessibility...",
              starts_on: "2023-06-15",
              type: "section",
              score: 10.0,
              structure_index: 17,
            },
            {
              hierarchy: { title: "29", section: "1630.2" },
              headings: { section: "Definitions" },
              full_text_excerpt: "...",
              starts_on: "2023-01-01",
              type: "section",
              score: 9.0,
              structure_index: 5,
            },
          ],
          meta: { current_page: 1, total_pages: 1, total_count: 3 },
        },
      },
    ]);
    client = makeClient(fetchMock);

    const hits = await client.searchCfr("accessibility", 2);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.source === "cfr")).toBe(true);
    expect(hits[0].title).toBe(28);
    expect(hits[0].section).toBe("35.104");
    expect(hits[0].citationBluebook).toBe("28 C.F.R. § 35.104");
    expect(hits[1].title).toBe(42);
    expect(hits[1].section).toBe("12101");

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/search/v1/results");
    expect(String(url)).toContain("query=accessibility");
    expect(String(url)).toContain("per_page=2");
  });

  it("retries on 500 and succeeds on third attempt", async () => {
    fetchMock = makeFetch([
      { status: 500, text: "" },
      { status: 500, text: "" },
      { status: 200, json: SAMPLE_STRUCTURE },
    ]);
    client = makeClient(fetchMock);

    const res = await client.lookupCfrSection(28, "35.104");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res!.section).toBe("35.104");
  });

  it("retries on 429 same as 500", async () => {
    fetchMock = makeFetch([
      { status: 429, text: "" },
      { status: 429, text: "" },
      { status: 200, json: SAMPLE_STRUCTURE },
    ]);
    client = makeClient(fetchMock);

    const res = await client.lookupCfrSection(28, "35.104");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res!.section).toBe("35.104");
  });

  it("throws EcfrError with status=500 after 3 failed attempts", async () => {
    fetchMock = makeFetch([
      { status: 500, text: "" },
      { status: 500, text: "" },
      { status: 500, text: "" },
    ]);
    client = makeClient(fetchMock);

    const err = await client.lookupCfrSection(28, "35.104").catch((e) => e);
    expect(err).toBeInstanceOf(EcfrError);
    expect((err as EcfrError).status).toBe(500);
    expect((err as Error).name).toBe("EcfrError");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects section values with disallowed characters", async () => {
    const c = new EcfrClient({
      fetchImpl: makeFetch([]) as unknown as typeof fetch,
    });
    await expect(c.lookupCfrSection(28, "35.104 OR 1=1")).rejects.toThrow(
      RangeError,
    );
  });
});
