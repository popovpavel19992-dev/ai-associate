import { describe, it, expect, vi } from "vitest";
import { generateBranches } from "@/server/services/deposition-branches/generate";

function makeAnthropic(text: string) {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }) } };
}

const baseArgs = {
  topic: { id: "t1", title: "Background", category: "background" as const },
  questions: [
    { id: "q1", number: 1, text: "Where did you train?" },
    { id: "q2", number: 2, text: "How many years experience?" },
  ],
  outline: { deponentName: "Dr. Smith", deponentRole: "expert" as const, servingParty: "plaintiff" as const },
  caseSummary: "med-mal",
  sources: [],
  posture: null,
};

const validJson = {
  questions: [
    {
      questionId: "q1",
      branches: [
        { answerType: "admit", likelyResponse: "Hopkins", likelihood: "high", followUps: [{ text: "Year?", purpose: "lock" }] },
        { answerType: "evade", likelyResponse: "several places", likelihood: "low", followUps: [{ text: "Specifically?", purpose: "redirect" }] },
      ],
    },
    {
      questionId: "q2",
      branches: [
        { answerType: "admit", likelyResponse: "20 years", likelihood: "high", followUps: [{ text: "Specialty?", purpose: "qualify" }] },
        { answerType: "deny", likelyResponse: "less", likelihood: "low", followUps: [{ text: "How many?", purpose: "pin" }] },
      ],
    },
  ],
  reasoningMd: "...",
  sources: [],
  confidenceOverall: "med",
};

describe("generateBranches", () => {
  it("returns parsed branches per question", async () => {
    const anthropic = makeAnthropic(JSON.stringify(validJson));
    const r = await generateBranches(baseArgs, { anthropic: anthropic as never });
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0].branches).toHaveLength(2);
  });

  it("normalizes 'medium' to 'med' for likelihood", async () => {
    const json = structuredClone(validJson);
    json.questions[0].branches[0].likelihood = "medium" as never;
    const anthropic = makeAnthropic(JSON.stringify(json));
    const r = await generateBranches(baseArgs, { anthropic: anthropic as never });
    expect(r.questions[0].branches[0].likelihood).toBe("med");
  });

  it("rejects unknown answerType", async () => {
    const json = structuredClone(validJson);
    (json.questions[0].branches[0] as never as { answerType: string }).answerType = "maybe";
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(generateBranches(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("rejects branch count out of [2..4]", async () => {
    const json = structuredClone(validJson);
    json.questions[0].branches = [json.questions[0].branches[0]];
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(generateBranches(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("rejects duplicate answerType within one question", async () => {
    const json = structuredClone(validJson);
    json.questions[0].branches[1].answerType = "admit";
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(generateBranches(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });

  it("strips ```json fences", async () => {
    const fenced = "```json\n" + JSON.stringify(validJson) + "\n```";
    const anthropic = makeAnthropic(fenced);
    const r = await generateBranches(baseArgs, { anthropic: anthropic as never });
    expect(r.questions).toHaveLength(2);
  });

  it("throws on invalid JSON", async () => {
    const anthropic = makeAnthropic("not json");
    await expect(generateBranches(baseArgs, { anthropic: anthropic as never })).rejects.toThrow();
  });
});
