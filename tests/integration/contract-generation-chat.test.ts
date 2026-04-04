import { describe, it, expect } from "vitest";

describe("Contract Generation Chat", () => {
  function validateChatScope(caseId?: string, contractId?: string, draftId?: string): boolean {
    const count = [caseId, contractId, draftId].filter(Boolean).length;
    return count === 1;
  }

  it("valid: only caseId set", () => { expect(validateChatScope("case-1", undefined, undefined)).toBe(true); });
  it("valid: only contractId set", () => { expect(validateChatScope(undefined, "contract-1", undefined)).toBe(true); });
  it("valid: only draftId set", () => { expect(validateChatScope(undefined, undefined, "draft-1")).toBe(true); });
  it("invalid: none set", () => { expect(validateChatScope(undefined, undefined, undefined)).toBe(false); });
  it("invalid: two set", () => {
    expect(validateChatScope("case-1", "contract-1", undefined)).toBe(false);
    expect(validateChatScope("case-1", undefined, "draft-1")).toBe(false);
  });
});
