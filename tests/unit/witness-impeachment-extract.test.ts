import { describe, it, expect, vi } from "vitest";
import { extractClaims } from "@/server/services/witness-impeachment/extract";

function makeAnthropic(text: string) {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }) } };
}

const baseArgs = {
  statementId: "s1",
  statementKind: "deposition" as const,
  statementText: "Long depo transcript text...",
  witnessFullName: "Dr. Smith",
};

const validJson = {
  claims: [
    { id: "c1", text: "I trained at Johns Hopkins.", locator: "p.47 line 12-15", topic: "qualifications" },
    { id: "c2", text: "I never had back pain before.", locator: "p.89 line 4-9", topic: "medical-history" },
  ],
};

describe("extractClaims", () => {
  it("returns parsed claims array", async () => {
    const anthropic = makeAnthropic(JSON.stringify(validJson));
    const r = await extractClaims(baseArgs, { anthropic: anthropic as never });
    expect(r.claims).toHaveLength(2);
    expect(r.claims[0].id).toBe("c1");
  });

  it("strips ```json fences", async () => {
    const fenced = "```json\n" + JSON.stringify(validJson) + "\n```";
    const anthropic = makeAnthropic(fenced);
    const r = await extractClaims(baseArgs, { anthropic: anthropic as never });
    expect(r.claims).toHaveLength(2);
  });

  it("accepts empty claims (boilerplate-only statement)", async () => {
    const anthropic = makeAnthropic(JSON.stringify({ claims: [] }));
    const r = await extractClaims(baseArgs, { anthropic: anthropic as never });
    expect(r.claims).toEqual([]);
  });

  it("accepts null locator", async () => {
    const json = { claims: [{ id: "c1", text: "claim", locator: null, topic: "general" }] };
    const anthropic = makeAnthropic(JSON.stringify(json));
    const r = await extractClaims(baseArgs, { anthropic: anthropic as never });
    expect(r.claims[0].locator).toBeNull();
  });

  it("rejects empty claim.text", async () => {
    const json = { claims: [{ id: "c1", text: "", locator: null, topic: "general" }] };
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(extractClaims(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("throws on invalid JSON", async () => {
    const anthropic = makeAnthropic("not json");
    await expect(extractClaims(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });
});
