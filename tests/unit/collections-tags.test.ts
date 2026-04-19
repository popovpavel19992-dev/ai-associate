// tests/unit/collections-tags.test.ts
import { describe, it, expect } from "vitest";
import { CollectionsService } from "@/server/services/research/collections";

describe("CollectionsService.normalizeTags", () => {
  it("lowercases tags", () => {
    expect(CollectionsService.normalizeTags(["Damages", "FAA"])).toEqual(["damages", "faa"]);
  });
  it("trims whitespace", () => {
    expect(CollectionsService.normalizeTags(["  hello "])).toEqual(["hello"]);
  });
  it("dedups duplicates", () => {
    expect(CollectionsService.normalizeTags(["a", "a", "A"])).toEqual(["a"]);
  });
  it("drops empty strings", () => {
    expect(CollectionsService.normalizeTags(["", "  ", "x"])).toEqual(["x"]);
  });
  it("drops tags over 50 chars", () => {
    expect(CollectionsService.normalizeTags(["a".repeat(51), "ok"])).toEqual(["ok"]);
  });
  it("preserves at boundary (50 chars)", () => {
    const fifty = "a".repeat(50);
    expect(CollectionsService.normalizeTags([fifty])).toEqual([fifty]);
  });
});
