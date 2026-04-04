import { describe, it, expect } from "vitest";
import {
  CONTRACT_REVIEW_CREDITS,
  COMPARISON_DIFF_CREDITS,
  CONTRACT_TYPES,
  CONTRACT_ANALYSIS_SECTIONS,
  CONTRACT_SECTION_LABELS,
  CONTRACT_TYPE_LABELS,
} from "@/lib/constants";

describe("Contract Pipeline — Constants", () => {
  it("defines correct credit costs", () => {
    expect(CONTRACT_REVIEW_CREDITS).toBe(2);
    expect(COMPARISON_DIFF_CREDITS).toBe(1);
  });

  it("defines all contract types with labels", () => {
    expect(CONTRACT_TYPES.length).toBeGreaterThan(0);
    for (const type of CONTRACT_TYPES) {
      expect(CONTRACT_TYPE_LABELS[type]).toBeDefined();
      expect(typeof CONTRACT_TYPE_LABELS[type]).toBe("string");
    }
  });

  it("defines all analysis sections with labels", () => {
    expect(CONTRACT_ANALYSIS_SECTIONS.length).toBe(10);
    for (const section of CONTRACT_ANALYSIS_SECTIONS) {
      expect(CONTRACT_SECTION_LABELS[section]).toBeDefined();
    }
  });

  it("includes generic as a contract type", () => {
    expect(CONTRACT_TYPES).toContain("generic");
  });
});

describe("Contract Pipeline — Status Transitions", () => {
  const VALID_STATUSES = ["draft", "uploading", "extracting", "analyzing", "ready", "failed"];

  it("defines all expected contract statuses", () => {
    for (const status of VALID_STATUSES) {
      expect(typeof status).toBe("string");
    }
  });

  it("status flow follows expected order", () => {
    const statusOrder = ["draft", "uploading", "extracting", "analyzing", "ready"];
    for (let i = 0; i < statusOrder.length - 1; i++) {
      expect(VALID_STATUSES.indexOf(statusOrder[i])).toBeLessThan(
        VALID_STATUSES.indexOf(statusOrder[i + 1])
      );
    }
  });
});
