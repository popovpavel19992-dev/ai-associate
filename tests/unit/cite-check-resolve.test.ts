import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  treatmentMock: vi.fn(),
  inngestSendMock: vi.fn(),
  treatmentSelectMock: vi.fn(),
  opinionSelectMock: vi.fn(),
  statuteSelectMock: vi.fn(),
  treatmentInsertMock: vi.fn(),
}));

vi.mock("@/server/services/cite-check/treatment", () => ({
  decideTreatment: mocks.treatmentMock,
}));
vi.mock("@/server/inngest/client", () => ({
  inngest: { send: mocks.inngestSendMock },
}));

vi.mock("@/server/db/schema/cite-treatments", () => ({
  citeTreatments: { _table: "treatments", citeKey: { _col: "cite_key" } },
}));
vi.mock("@/server/db/schema/cached-opinions", () => ({
  cachedOpinions: { _table: "opinions", citationBluebook: { _col: "citation_bluebook" } },
}));
vi.mock("@/server/db/schema/cached-statutes", () => ({
  cachedStatutes: { _table: "statutes", citationBluebook: { _col: "citation_bluebook" } },
}));

vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _table?: string }) => {
        const which = tbl?._table;
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve(
                which === "treatments"
                  ? mocks.treatmentSelectMock()
                  : which === "opinions"
                  ? mocks.opinionSelectMock()
                  : mocks.statuteSelectMock(),
              ),
            ),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => mocks.treatmentInsertMock()),
      })),
    })),
  },
}));

beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

describe("resolveCite", () => {
  it("treatment cache hit → returns cached, no charge, no inngest", async () => {
    mocks.treatmentSelectMock.mockResolvedValue([
      { citeKey: "550_us_544_2007", citeType: "opinion", status: "good_law", summary: "x", signals: { citedByCount: 1283 } },
    ]);
    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "Twombly, 550 U.S. 544 (2007)", type: "opinion", citeKey: "550_us_544_2007", motionId: "m1" });
    expect(out.status).toBe("good_law");
    expect(out.charged).toBe(false);
    expect(mocks.inngestSendMock).not.toHaveBeenCalled();
    expect(mocks.treatmentMock).not.toHaveBeenCalled();
  });

  it("cached opinion hit → runs treatment + persists + charges", async () => {
    mocks.treatmentSelectMock.mockResolvedValue([]);
    mocks.opinionSelectMock.mockResolvedValue([{ id: "o1", fullText: "long text", metadata: { citedByCount: 100 } }]);
    mocks.treatmentMock.mockResolvedValue({ status: "good_law", summary: "ok", signals: { citedByCount: 100 } });
    mocks.treatmentInsertMock.mockResolvedValue([{}]);

    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "x", type: "opinion", citeKey: "k1", motionId: "m1" });
    expect(out.status).toBe("good_law");
    expect(out.charged).toBe(true);
    expect(mocks.treatmentMock).toHaveBeenCalledOnce();
  });

  it("both cache miss → emits Inngest event, returns pending", async () => {
    mocks.treatmentSelectMock.mockResolvedValue([]);
    mocks.opinionSelectMock.mockResolvedValue([]);
    mocks.statuteSelectMock.mockResolvedValue([]);

    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "Smith v. Jones, 999 F.4d 1", type: "opinion", citeKey: "999_f4d_1", motionId: "m1" });
    expect(out.status).toBe("pending");
    expect(out.charged).toBe(false);
    expect(mocks.inngestSendMock).toHaveBeenCalledOnce();
  });

  it("malformed citeKey skips DB lookups → returns malformed", async () => {
    const { resolveCite } = await import("@/server/services/cite-check/resolve");
    const out = await resolveCite({ raw: "id.", type: "opinion", citeKey: "malformed", motionId: "m1" });
    expect(out.status).toBe("malformed");
    expect(out.charged).toBe(false);
    expect(mocks.inngestSendMock).not.toHaveBeenCalled();
  });
});
