// tests/unit/witness-impeachment-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  collectSourcesMock: vi.fn(),
  extractClaimsMock: vi.fn(),
  scanContradictionsMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  witnessRows: vi.fn(),
  documentRows: vi.fn(), // for from(documents) — caseStateHash + attach validation
  attachedRows: vi.fn(), // for from(caseWitnessStatements) joined w/ documents
  scanCacheRows: vi.fn(), // cwis cache lookup (no orderBy)
  scanLatestRows: vi.fn(), // cwis latest (with orderBy)
  caseRows: vi.fn(),
  postureRows: vi.fn(),
  insertScanMock: vi.fn(),
  insertStatementMock: vi.fn(),
  // Track the where() calls so we can assert defense-in-depth.
  whereCalls: [] as Array<{ table: string | undefined; hasOrderBy: boolean }>,
}));

vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));

vi.mock("@/server/services/witness-impeachment/sources", () => ({
  collectEvidenceSources: mocks.collectSourcesMock,
}));
vi.mock("@/server/services/witness-impeachment/extract", () => ({
  extractClaims: mocks.extractClaimsMock,
}));
vi.mock("@/server/services/witness-impeachment/scan", () => ({
  scanContradictions: mocks.scanContradictionsMock,
}));

// Drizzle helpers — we don't care about their actual behavior.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...xs: unknown[]) => ({ _and: xs }),
    eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
    asc: (x: unknown) => ({ _asc: x }),
    desc: (x: unknown) => ({ _desc: x }),
    max: (x: unknown) => ({ _max: x }),
  };
});

vi.mock("@/server/db/schema/cases", () => ({
  cases: {
    _table: "cases",
    id: { _col: "cases.id" },
    orgId: { _col: "cases.orgId" },
    name: { _col: "cases.name" },
    description: { _col: "cases.description" },
  },
}));
vi.mock("@/server/db/schema/documents", () => ({
  documents: {
    _table: "documents",
    id: { _col: "documents.id" },
    caseId: { _col: "documents.caseId" },
    filename: { _col: "documents.filename" },
    status: { _col: "documents.status" },
    extractedText: { _col: "documents.extractedText" },
    createdAt: { _col: "documents.createdAt" },
  },
}));
vi.mock("@/server/db/schema/case-witnesses", () => ({
  caseWitnesses: {
    _table: "witnesses",
    id: { _col: "witnesses.id" },
    listId: { _col: "witnesses.listId" },
  },
}));
vi.mock("@/server/db/schema/case-witness-lists", () => ({
  caseWitnessLists: {
    _table: "witness_lists",
    id: { _col: "witness_lists.id" },
    caseId: { _col: "witness_lists.caseId" },
    orgId: { _col: "witness_lists.orgId" },
  },
}));
vi.mock("@/server/db/schema/case-witness-statements", () => ({
  caseWitnessStatements: {
    _table: "statements",
    id: { _col: "statements.id" },
    orgId: { _col: "statements.orgId" },
    caseId: { _col: "statements.caseId" },
    witnessId: { _col: "statements.witnessId" },
    documentId: { _col: "statements.documentId" },
    statementKind: { _col: "statements.statementKind" },
    statementDate: { _col: "statements.statementDate" },
    notes: { _col: "statements.notes" },
    createdAt: { _col: "statements.createdAt" },
  },
}));
vi.mock("@/server/db/schema/case-witness-impeachment-scans", () => ({
  caseWitnessImpeachmentScans: {
    _table: "scans",
    id: { _col: "scans.id" },
    orgId: { _col: "scans.orgId" },
    caseId: { _col: "scans.caseId" },
    witnessId: { _col: "scans.witnessId" },
    cacheHash: { _col: "scans.cacheHash" },
    createdAt: { _col: "scans.createdAt" },
  },
}));
vi.mock("@/server/db/schema/opposing-counsel-postures", () => ({
  opposingCounselPostures: {
    _table: "postures",
    orgId: { _col: "postures.orgId" },
    caseId: { _col: "postures.caseId" },
    createdAt: { _col: "postures.createdAt" },
  },
}));

vi.mock("@/server/db", () => {
  type Tagged = { _table?: string };

  const rowsForTable = (
    tag: string | undefined,
    ctx: { hasOrderBy: boolean },
  ): unknown[] => {
    if (tag === "witnesses") return mocks.witnessRows();
    if (tag === "documents") return mocks.documentRows();
    if (tag === "statements") return mocks.attachedRows();
    if (tag === "scans")
      return ctx.hasOrderBy ? mocks.scanLatestRows() : mocks.scanCacheRows();
    if (tag === "cases") return mocks.caseRows();
    if (tag === "postures") return mocks.postureRows();
    return [];
  };

  const buildSelect = () => {
    const ctx = { hasOrderBy: false };
    let currentTable: Tagged | undefined;

    const thenable = {
      then: (resolve: (rows: unknown[]) => unknown) => {
        const rows = rowsForTable(currentTable?._table, ctx);
        return Promise.resolve(rows).then(resolve);
      },
    };

    const where = vi.fn((_cond: unknown) => {
      mocks.whereCalls.push({
        table: currentTable?._table,
        hasOrderBy: ctx.hasOrderBy,
      });
      return {
        ...thenable,
        orderBy: vi.fn(() => {
          ctx.hasOrderBy = true;
          return {
            limit: vi.fn(() => {
              const rows = rowsForTable(currentTable?._table, ctx);
              return Promise.resolve(rows);
            }),
            ...thenable,
          };
        }),
      };
    });

    const innerJoin = vi.fn(() => ({
      where,
      innerJoin: vi.fn(() => ({ where })),
    }));

    const fromFn = vi.fn((tbl: Tagged) => {
      currentTable = tbl;
      return { where, innerJoin };
    });

    return { from: fromFn };
  };

  const dbObj = {
    select: vi.fn(() => buildSelect()),
    insert: vi.fn((tbl: Tagged) => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => {
          if (tbl?._table === "scans")
            return Promise.resolve(mocks.insertScanMock());
          if (tbl?._table === "statements")
            return Promise.resolve(mocks.insertStatementMock());
          return Promise.resolve([{ id: "row" }]);
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(undefined)),
    })),
  };
  return { db: dbObj };
});

import {
  runScanFlow,
  attachStatement,
  NotBetaOrgError,
  InsufficientCreditsError,
  WitnessNotFoundError,
  NoStatementsError,
  NotExtractedError,
  NoClaimsError,
} from "@/server/services/witness-impeachment";

const baseWitness = {
  id: "witness-1",
  listId: "list-1",
  fullName: "Jane Doe",
  titleOrRole: "Paramedic",
  category: "fact",
  partyAffiliation: "non_party",
};

const baseAttached = [
  {
    statementId: "stmt-1",
    documentId: "doc-1",
    statementKind: "deposition",
    statementDate: "2025-01-15",
    filename: "depo-1.pdf",
    extractedText: "I arrived at the scene at 3pm.",
  },
  {
    statementId: "stmt-2",
    documentId: "doc-2",
    statementKind: "declaration",
    statementDate: "2025-02-10",
    filename: "decl-1.pdf",
    extractedText: "I arrived at the scene at 4pm.",
  },
];

const extractStub = {
  claims: [
    { id: "c1", text: "Arrived at 3pm", locator: "p1", topic: "arrival_time" },
  ],
  reasoningMd: "claims found",
  confidenceOverall: "high" as const,
};

const scanStub = {
  contradictions: [
    {
      id: "x1",
      kind: "self" as const,
      severity: "direct" as const,
      summary: "Conflicting arrival times",
      leftQuote: { text: "3pm", statementId: "stmt-1", documentId: null, locator: "p1" },
      rightQuote: { text: "4pm", statementId: "stmt-2", documentId: null, locator: "p1" },
      impeachmentQuestions: ["What time did you arrive?", "Are you sure?"],
    },
  ],
  reasoningMd: "## reasoning",
  sources: [{ id: "s1", title: "Source 1" }],
  confidenceOverall: "high" as const,
};

const baseArgs = {
  orgId: "org-1",
  userId: "u-1",
  caseId: "case-1",
  witnessId: "witness-1",
};

describe("witness-impeachment orchestrator", () => {
  beforeEach(() => {
    Object.entries(mocks).forEach(([k, m]) => {
      if (k === "whereCalls") return;
      (m as { mockReset?: () => void }).mockReset?.();
    });
    mocks.whereCalls.length = 0;
    vi.stubEnv("STRATEGY_BETA_ORG_IDS", "org-1");
    mocks.decrementMock.mockResolvedValue(true);
    mocks.refundMock.mockResolvedValue(undefined);
    mocks.collectSourcesMock.mockResolvedValue([]);
    mocks.extractClaimsMock.mockResolvedValue(extractStub);
    mocks.scanContradictionsMock.mockResolvedValue(scanStub);
    mocks.witnessRows.mockReturnValue([
      { witness: baseWitness, list: { id: "list-1" } },
    ]);
    mocks.documentRows.mockReturnValue([
      { latest: new Date("2025-03-01T00:00:00Z") },
    ]);
    mocks.attachedRows.mockReturnValue(baseAttached);
    mocks.scanCacheRows.mockReturnValue([]);
    mocks.scanLatestRows.mockReturnValue([]);
    mocks.caseRows.mockReturnValue([{ name: "Case", description: "summary" }]);
    mocks.postureRows.mockReturnValue([]);
    mocks.insertScanMock.mockReturnValue([{ id: "scan-new" }]);
    mocks.insertStatementMock.mockReturnValue([{ id: "stmt-new" }]);
  });

  it("rejects non-beta org with NotBetaOrgError, no credit charge", async () => {
    await expect(
      runScanFlow({ ...baseArgs, orgId: "other" }),
    ).rejects.toBeInstanceOf(NotBetaOrgError);
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("throws WitnessNotFoundError when witness missing", async () => {
    mocks.witnessRows.mockReturnValue([]);
    await expect(runScanFlow(baseArgs)).rejects.toBeInstanceOf(
      WitnessNotFoundError,
    );
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("throws NoStatementsError when no statements attached, no charge", async () => {
    mocks.attachedRows.mockReturnValue([]);
    await expect(runScanFlow(baseArgs)).rejects.toBeInstanceOf(
      NoStatementsError,
    );
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("throws NotExtractedError when any doc empty extractedText, no charge", async () => {
    mocks.attachedRows.mockReturnValue([
      { ...baseAttached[0] },
      { ...baseAttached[1], extractedText: null },
    ]);
    await expect(runScanFlow(baseArgs)).rejects.toBeInstanceOf(
      NotExtractedError,
    );
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("cache hit: returns existing row, does NOT charge or call extract/scan", async () => {
    mocks.scanCacheRows.mockReturnValue([
      { id: "scan-cached", reasoningMd: "cached" },
    ]);
    const r = await runScanFlow(baseArgs);
    expect((r as { id: string }).id).toBe("scan-cached");
    expect(mocks.decrementMock).not.toHaveBeenCalled();
    expect(mocks.extractClaimsMock).not.toHaveBeenCalled();
    expect(mocks.scanContradictionsMock).not.toHaveBeenCalled();
  });

  it("insufficient credits throws InsufficientCreditsError without calling extract/scan", async () => {
    mocks.decrementMock.mockResolvedValueOnce(false);
    await expect(runScanFlow(baseArgs)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(mocks.extractClaimsMock).not.toHaveBeenCalled();
    expect(mocks.scanContradictionsMock).not.toHaveBeenCalled();
    expect(mocks.refundMock).not.toHaveBeenCalled();
  });

  it("cache miss happy path: charges 4cr, calls extract per statement, calls scan, inserts row", async () => {
    const r = await runScanFlow(baseArgs);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 4);
    expect(mocks.extractClaimsMock).toHaveBeenCalledTimes(2);
    expect(mocks.scanContradictionsMock).toHaveBeenCalledTimes(1);
    const scanArgs = mocks.scanContradictionsMock.mock.calls[0][0];
    expect(scanArgs.witness.fullName).toBe("Jane Doe");
    expect(scanArgs.witness.titleOrRole).toBe("Paramedic");
    expect(scanArgs.statements).toHaveLength(2);
    expect(scanArgs.posture).toBeNull();
    expect(mocks.refundMock).not.toHaveBeenCalled();
    expect((r as { id: string }).id).toBe("scan-new");
  });

  it("throws NoClaimsError after extract step and refunds credits", async () => {
    mocks.extractClaimsMock.mockResolvedValue({
      claims: [],
      reasoningMd: "",
      confidenceOverall: "low" as const,
    });
    await expect(runScanFlow(baseArgs)).rejects.toBeInstanceOf(NoClaimsError);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 4);
    expect(mocks.refundMock).toHaveBeenCalledWith("u-1", 4);
    expect(mocks.scanContradictionsMock).not.toHaveBeenCalled();
  });

  it("refunds credits when extract throws", async () => {
    mocks.extractClaimsMock.mockRejectedValue(new Error("extract down"));
    await expect(runScanFlow(baseArgs)).rejects.toThrow(/extract down/);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 4);
    expect(mocks.refundMock).toHaveBeenCalledWith("u-1", 4);
  });

  it("refunds credits when scan throws", async () => {
    mocks.scanContradictionsMock.mockRejectedValueOnce(new Error("scan boom"));
    await expect(runScanFlow(baseArgs)).rejects.toThrow(/scan boom/);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 4);
    expect(mocks.refundMock).toHaveBeenCalledWith("u-1", 4);
  });

  it("refunds credits when db.insert fails after successful scan", async () => {
    mocks.insertScanMock.mockImplementationOnce(() => {
      throw new Error("insert exploded");
    });
    await expect(runScanFlow(baseArgs)).rejects.toThrow(/insert exploded/);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 4);
    expect(mocks.scanContradictionsMock).toHaveBeenCalledTimes(1);
    expect(mocks.refundMock).toHaveBeenCalledWith("u-1", 4);
  });

  it("defense-in-depth: orgId scoping queried for statements/cases/postures/scans", async () => {
    await runScanFlow(baseArgs);
    // Each table that the orchestrator queries directly with org scope must
    // appear in at least one where() invocation.
    const tables = mocks.whereCalls.map((c) => c.table);
    expect(tables).toContain("witnesses"); // witness lookup with org scope (via list join)
    expect(tables).toContain("statements"); // attached statements
    expect(tables).toContain("scans"); // cache lookup
    expect(tables).toContain("cases"); // case summary
    expect(tables).toContain("postures"); // posture
  });

  it("attachStatement: rejects when witness not in case+org (defense-in-depth)", async () => {
    mocks.witnessRows.mockReturnValue([]);
    await expect(
      attachStatement({
        ...baseArgs,
        documentId: "doc-1",
        statementKind: "deposition",
      }),
    ).rejects.toBeInstanceOf(WitnessNotFoundError);
  });

  it("attachStatement: rejects when document not in case", async () => {
    mocks.witnessRows.mockReturnValue([
      { witness: baseWitness, list: { id: "list-1" } },
    ]);
    mocks.documentRows.mockReturnValue([]); // doc lookup empty
    await expect(
      attachStatement({
        ...baseArgs,
        documentId: "doc-1",
        statementKind: "deposition",
      }),
    ).rejects.toBeInstanceOf(WitnessNotFoundError);
  });

  it("attachStatement: inserts row when witness+doc valid", async () => {
    mocks.witnessRows.mockReturnValue([
      { witness: baseWitness, list: { id: "list-1" } },
    ]);
    mocks.documentRows.mockReturnValue([{ id: "doc-1", caseId: "case-1" }]);
    const r = await attachStatement({
      ...baseArgs,
      documentId: "doc-1",
      statementKind: "deposition",
    });
    expect((r as { id: string }).id).toBe("stmt-new");
  });
});
