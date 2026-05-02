import { describe, it, expect } from "vitest";
import {
  computeQuestionsHash,
  isStaleSnapshot,
  type QuestionLike,
} from "@/server/services/deposition-branches/compute";

describe("computeQuestionsHash", () => {
  it("is deterministic for same input ordering", () => {
    const qs: QuestionLike[] = [
      { id: "a", text: "q1" },
      { id: "b", text: "q2" },
    ];
    expect(computeQuestionsHash(qs)).toBe(computeQuestionsHash(qs));
  });

  it("is order-independent (sorted internally by id)", () => {
    const a = computeQuestionsHash([{ id: "a", text: "q1" }, { id: "b", text: "q2" }]);
    const b = computeQuestionsHash([{ id: "b", text: "q2" }, { id: "a", text: "q1" }]);
    expect(a).toBe(b);
  });

  it("changes when text changes", () => {
    const a = computeQuestionsHash([{ id: "a", text: "q1" }]);
    const b = computeQuestionsHash([{ id: "a", text: "q1!" }]);
    expect(a).not.toBe(b);
  });

  it("changes when a question is added", () => {
    const a = computeQuestionsHash([{ id: "a", text: "q1" }]);
    const b = computeQuestionsHash([{ id: "a", text: "q1" }, { id: "b", text: "q2" }]);
    expect(a).not.toBe(b);
  });
});

describe("isStaleSnapshot", () => {
  it("not stale when snapshot equals current", () => {
    const snap = [{ questionId: "a", number: 1, text: "q1" }];
    const cur = [{ id: "a", text: "q1" }];
    expect(isStaleSnapshot(snap, cur)).toBe(false);
  });

  it("stale when text changed", () => {
    const snap = [{ questionId: "a", number: 1, text: "q1" }];
    const cur = [{ id: "a", text: "q1!" }];
    expect(isStaleSnapshot(snap, cur)).toBe(true);
  });

  it("stale when question added", () => {
    const snap = [{ questionId: "a", number: 1, text: "q1" }];
    const cur = [{ id: "a", text: "q1" }, { id: "b", text: "q2" }];
    expect(isStaleSnapshot(snap, cur)).toBe(true);
  });

  it("stale when question removed", () => {
    const snap = [{ questionId: "a", number: 1, text: "q1" }, { questionId: "b", number: 2, text: "q2" }];
    const cur = [{ id: "a", text: "q1" }];
    expect(isStaleSnapshot(snap, cur)).toBe(true);
  });
});
