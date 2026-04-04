import { describe, it, expect } from "vitest";
import { GENERATION_CREDITS, CONTRACT_REVIEW_CREDITS } from "@/lib/constants";

describe("Contract Generation Credits", () => {
  it("charges 3 credits for generation", () => { expect(GENERATION_CREDITS).toBe(3); });
  it("charges 2 credits for send-to-review", () => { expect(CONTRACT_REVIEW_CREDITS).toBe(2); });
  it("full cycle costs 5 credits (generate + review)", () => { expect(GENERATION_CREDITS + CONTRACT_REVIEW_CREDITS).toBe(5); });
});
