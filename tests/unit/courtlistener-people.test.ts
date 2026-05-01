import { describe, it, expect, vi, beforeEach } from "vitest";
import { CourtListenerClient } from "@/server/services/courtlistener/client";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("CourtListenerClient.people", () => {
  beforeEach(() => fetchMock.mockReset());

  it("queries by name and returns parsed list", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ count: 1, results: [{ id: 42, name_full: "Jane Smith", positions: [] }] }), { status: 200 }),
    );
    const client = new CourtListenerClient({ apiKey: "test" });
    const res = await client.people({ name: "Jane Smith" });
    expect(res.results[0].id).toBe(42);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/rest/v4/people/");
    expect(fetchMock.mock.calls[0][0]).toContain("name_full__icontains=Jane+Smith");
  });

  it("uses injected fetchImpl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }),
    );
    const client = new CourtListenerClient({ apiKey: "test", fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.people({ name: "x" });
    expect(fetchImpl).toHaveBeenCalled();
  });
});
