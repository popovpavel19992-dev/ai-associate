import { describe, it, expect } from "vitest";
import {
  contentHash,
  computeStatementsHash,
  isStaleStatementSet,
  type StatementLike,
} from "@/server/services/witness-impeachment/compute";

describe("contentHash", () => {
  it("is deterministic", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
  });
  it("differs for different inputs", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

describe("computeStatementsHash", () => {
  it("is order-independent (sorted by statementId)", () => {
    const a: StatementLike[] = [
      { statementId: "s1", text: "alpha" },
      { statementId: "s2", text: "beta" },
    ];
    const b: StatementLike[] = [
      { statementId: "s2", text: "beta" },
      { statementId: "s1", text: "alpha" },
    ];
    expect(computeStatementsHash(a)).toBe(computeStatementsHash(b));
  });
  it("changes when text changes", () => {
    const a = computeStatementsHash([{ statementId: "s1", text: "alpha" }]);
    const b = computeStatementsHash([{ statementId: "s1", text: "alpha2" }]);
    expect(a).not.toBe(b);
  });
  it("changes when statement added", () => {
    const a = computeStatementsHash([{ statementId: "s1", text: "alpha" }]);
    const b = computeStatementsHash([
      { statementId: "s1", text: "alpha" },
      { statementId: "s2", text: "beta" },
    ]);
    expect(a).not.toBe(b);
  });
});

describe("isStaleStatementSet", () => {
  it("not stale when snapshot equals current", () => {
    const snap = [{ statementId: "s1", documentId: "d1", statementKind: "deposition", statementDate: null, contentHash: "h1" }];
    const cur = [{ statementId: "s1", contentHash: "h1" }];
    expect(isStaleStatementSet(snap as never, cur)).toBe(false);
  });
  it("stale when contentHash changes", () => {
    const snap = [{ statementId: "s1", documentId: "d1", statementKind: "deposition", statementDate: null, contentHash: "h1" }];
    const cur = [{ statementId: "s1", contentHash: "h2" }];
    expect(isStaleStatementSet(snap as never, cur)).toBe(true);
  });
  it("stale when statement added", () => {
    const snap = [{ statementId: "s1", documentId: "d1", statementKind: "deposition", statementDate: null, contentHash: "h1" }];
    const cur = [{ statementId: "s1", contentHash: "h1" }, { statementId: "s2", contentHash: "h2" }];
    expect(isStaleStatementSet(snap as never, cur)).toBe(true);
  });
  it("stale when statement removed", () => {
    const snap = [
      { statementId: "s1", documentId: "d1", statementKind: "deposition", statementDate: null, contentHash: "h1" },
      { statementId: "s2", documentId: "d2", statementKind: "declaration", statementDate: null, contentHash: "h2" },
    ];
    const cur = [{ statementId: "s1", contentHash: "h1" }];
    expect(isStaleStatementSet(snap as never, cur)).toBe(true);
  });
});
