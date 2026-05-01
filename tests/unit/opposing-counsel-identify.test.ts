import { describe, it, expect, vi } from "vitest";
import { matchAttorney, normalizeName } from "@/server/services/opposing-counsel/identify";
import type { CourtListenerClient } from "@/server/services/courtlistener/client";
import type { PeopleResponse } from "@/server/services/courtlistener/types";

function makeClient(response: PeopleResponse): CourtListenerClient {
  return {
    people: vi.fn(async () => response),
  } as unknown as CourtListenerClient;
}

describe("normalizeName", () => {
  it("strips suffix and middle initial", () => {
    expect(normalizeName("Jane A. Smith, Esq.")).toBe("jane smith");
  });

  it("returns empty for whitespace-only", () => {
    expect(normalizeName("   ")).toBe("");
  });

  it("strips Jr./Sr./III suffixes", () => {
    expect(normalizeName("John Doe Jr.")).toBe("john doe");
    expect(normalizeName("Robert Roe III")).toBe("robert roe");
  });
});

describe("matchAttorney", () => {
  it("returns best match above threshold with firm boost", async () => {
    const client = makeClient({
      count: 2,
      results: [
        { id: 1, name_full: "Jane A. Smith", positions: [{ organization_name: "Smith & Co" }] },
        { id: 2, name_full: "Jane Smithson", positions: [] },
      ],
    });
    const r = await matchAttorney({ name: "Jane Smith", firm: "Smith & Co" }, { client });
    expect(r).not.toBeNull();
    expect(r!.clPersonId).toBe("1");
    expect(r!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r!.clFirmName).toBe("Smith & Co");
  });

  it("returns null below threshold", async () => {
    const client = makeClient({ count: 0, results: [] });
    const r = await matchAttorney({ name: "Bob Nobody" }, { client });
    expect(r).toBeNull();
  });

  it("returns null when CourtListener throws", async () => {
    const client = {
      people: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as CourtListenerClient;
    const r = await matchAttorney({ name: "Jane Smith" }, { client });
    expect(r).toBeNull();
  });

  it("returns null for empty name", async () => {
    const client = makeClient({ count: 0, results: [] });
    const r = await matchAttorney({ name: "   " }, { client });
    expect(r).toBeNull();
  });
});
