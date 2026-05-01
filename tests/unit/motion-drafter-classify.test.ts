import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { classifyTemplate } from "@/server/services/motion-drafter/classify";
import type { TemplateOption } from "@/server/services/motion-drafter/types";

const TEMPLATES: TemplateOption[] = [
  { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "Motion to Dismiss (12(b)(6))", description: "Failure to state a claim" },
  { id: "t-msj", slug: "motion_for_summary_judgment", name: "Motion for Summary Judgment", description: "FRCP 56" },
  { id: "t-mtc", slug: "motion_to_compel", name: "Motion to Compel Discovery", description: "FRCP 37" },
];

beforeEach(() => messagesCreateMock.mockReset());

describe("classifyTemplate", () => {
  it("happy path: picks valid template + parses confidence", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ template_id: "t-mtd", confidence: 0.92, reasoning: "MTD signals" }) }],
    });
    const out = await classifyTemplate(
      { title: "File Motion to Dismiss for failure to state a claim", rationale: "Plaintiff lacks elements", category: "procedural" },
      TEMPLATES,
    );
    expect(out.templateId).toBe("t-mtd");
    expect(out.confidence).toBeCloseTo(0.92);
    expect(out.reasoning).toContain("MTD");
  });

  it("hallucinated id → null template, confidence 0", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ template_id: "t-fake", confidence: 0.99, reasoning: "x" }) }],
    });
    const out = await classifyTemplate(
      { title: "x", rationale: "x", category: "procedural" },
      TEMPLATES,
    );
    expect(out.templateId).toBeNull();
    expect(out.confidence).toBe(0);
  });

  it("malformed JSON → throws parse error", async () => {
    messagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "not json" }] });
    await expect(
      classifyTemplate({ title: "x", rationale: "x", category: "procedural" }, TEMPLATES),
    ).rejects.toThrow(/parse/i);
  });

  it("clamps confidence to [0,1]", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ template_id: "t-mtd", confidence: 1.5, reasoning: "x" }) }],
    });
    const out = await classifyTemplate({ title: "x", rationale: "x", category: "procedural" }, TEMPLATES);
    expect(out.confidence).toBe(1);
  });
});
