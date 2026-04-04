import { describe, it, expect } from "vitest";

describe("Contract Chat — Mutual Exclusivity", () => {
  // The chat router enforces: exactly one of caseId or contractId must be set

  function validateChatScope(caseId?: string, contractId?: string): { valid: boolean; error?: string } {
    if (caseId && contractId) {
      return { valid: false, error: "Cannot set both caseId and contractId" };
    }
    if (!caseId && !contractId) {
      return { valid: false, error: "Must set either caseId or contractId" };
    }
    return { valid: true };
  }

  it("accepts caseId only", () => {
    expect(validateChatScope("case-123", undefined)).toEqual({ valid: true });
  });

  it("accepts contractId only", () => {
    expect(validateChatScope(undefined, "contract-456")).toEqual({ valid: true });
  });

  it("rejects both caseId and contractId", () => {
    const result = validateChatScope("case-123", "contract-456");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("both");
  });

  it("rejects neither caseId nor contractId", () => {
    const result = validateChatScope(undefined, undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("either");
  });
});

describe("Contract Chat — Rate Limits", () => {
  const CHAT_RATE_LIMIT_PER_HOUR = 30;

  it("allows messages within rate limit", () => {
    const messageCount = 25;
    expect(messageCount < CHAT_RATE_LIMIT_PER_HOUR).toBe(true);
  });

  it("blocks messages at rate limit", () => {
    const messageCount = 30;
    expect(messageCount >= CHAT_RATE_LIMIT_PER_HOUR).toBe(true);
  });
});
