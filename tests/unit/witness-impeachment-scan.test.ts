import { describe, it, expect, vi } from "vitest";
import { scanContradictions } from "@/server/services/witness-impeachment/scan";

function makeAnthropic(text: string) {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }) } };
}

const baseArgs = {
  witness: { fullName: "Dr. Smith", titleOrRole: "Treating physician", category: "expert" as const, partyAffiliation: "plaintiff" as const },
  caseSummary: "med-mal",
  statements: [
    { statementId: "s1", statementKind: "deposition" as const, filename: "depo.pdf" },
    { statementId: "s2", statementKind: "declaration" as const, filename: "decl.pdf" },
  ],
  claims: [
    { statementId: "s1", claims: [{ id: "c1", text: "I was in Boston on March 15", locator: "p.47", topic: "timeline" }] },
    { statementId: "s2", claims: [{ id: "c2", text: "I inspected Cleveland site on March 15", locator: "¶8", topic: "timeline" }] },
  ],
  sources: [{ id: "d10", title: "med-record.pdf", excerpt: "chronic back pain 18mo" }],
  posture: null,
};

const validJson = {
  contradictions: [
    {
      id: "x1",
      kind: "self",
      severity: "direct",
      summary: "Witness placed himself in two locations on the same date",
      leftQuote: { text: "I was in Boston on March 15", statementId: "s1", documentId: null, locator: "p.47" },
      rightQuote: { text: "I inspected Cleveland site on March 15", statementId: "s2", documentId: null, locator: "¶8" },
      impeachmentQuestions: [
        "Mr. Smith, in your deposition you said you were in Boston on March 15, correct?",
        "But in your declaration you say you inspected a Cleveland site on the same date — which is true?",
        "Were you simultaneously in Boston and Cleveland?",
      ],
    },
  ],
  reasoningMd: "...",
  sources: [{ id: "d10", title: "med-record.pdf" }],
  confidenceOverall: "high",
};

describe("scanContradictions", () => {
  it("returns parsed contradictions array", async () => {
    const anthropic = makeAnthropic(JSON.stringify(validJson));
    const r = await scanContradictions(baseArgs, { anthropic: anthropic as never });
    expect(r.contradictions).toHaveLength(1);
    expect(r.contradictions[0].kind).toBe("self");
    expect(r.contradictions[0].severity).toBe("direct");
    expect(r.contradictions[0].impeachmentQuestions).toHaveLength(3);
  });

  it("normalizes 'medium' to 'med' for confidenceOverall", async () => {
    const json = structuredClone(validJson);
    json.confidenceOverall = "medium" as never;
    const anthropic = makeAnthropic(JSON.stringify(json));
    const r = await scanContradictions(baseArgs, { anthropic: anthropic as never });
    expect(r.confidenceOverall).toBe("med");
  });

  it("rejects unknown severity", async () => {
    const json = structuredClone(validJson);
    json.contradictions[0].severity = "critical" as never;
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(scanContradictions(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("rejects unknown kind", async () => {
    const json = structuredClone(validJson);
    json.contradictions[0].kind = "between-witnesses" as never;
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(scanContradictions(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("rejects impeachmentQuestions length outside [2,3]", async () => {
    const json = structuredClone(validJson);
    json.contradictions[0].impeachmentQuestions = ["only one"];
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(scanContradictions(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("rejects quote with both statementId AND documentId set", async () => {
    const json = structuredClone(validJson);
    json.contradictions[0].leftQuote.documentId = "d99" as never;
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(scanContradictions(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("rejects quote with neither statementId NOR documentId", async () => {
    const json = structuredClone(validJson);
    json.contradictions[0].leftQuote.statementId = null as never;
    json.contradictions[0].leftQuote.documentId = null as never;
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(scanContradictions(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("accepts evidence-kind contradiction with documentId-anchored right quote", async () => {
    const json = structuredClone(validJson);
    json.contradictions[0].kind = "evidence";
    json.contradictions[0].rightQuote.statementId = null as never;
    json.contradictions[0].rightQuote.documentId = "d10" as never;
    const anthropic = makeAnthropic(JSON.stringify(json));
    const r = await scanContradictions(baseArgs, { anthropic: anthropic as never });
    expect(r.contradictions[0].kind).toBe("evidence");
    expect(r.contradictions[0].rightQuote.documentId).toBe("d10");
  });

  it("strips ```json fences", async () => {
    const fenced = "```json\n" + JSON.stringify(validJson) + "\n```";
    const anthropic = makeAnthropic(fenced);
    const r = await scanContradictions(baseArgs, { anthropic: anthropic as never });
    expect(r.contradictions).toHaveLength(1);
  });

  it("throws on invalid JSON", async () => {
    const anthropic = makeAnthropic("not json");
    await expect(scanContradictions(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });
});
