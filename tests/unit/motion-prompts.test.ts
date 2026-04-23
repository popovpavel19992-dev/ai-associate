import { describe, it, expect } from "vitest";
import { renderPrompt, SYSTEM_PROMPTS } from "@/server/services/motions/prompts";

describe("motion prompts", () => {
  it("exports a system prompt for each motion type per section", () => {
    for (const mt of ["motion_to_dismiss", "motion_for_summary_judgment", "motion_to_compel"] as const) {
      for (const sk of ["facts", "argument", "conclusion"] as const) {
        expect(SYSTEM_PROMPTS[mt][sk]).toMatch(/.+/);
      }
    }
  });

  it("renders placeholders for case facts and attached memos", () => {
    const out = renderPrompt("motion_to_dismiss", "argument", {
      caseFacts: "Plaintiff slipped on a wet floor.",
      attachedMemos: [{ id: "m1", title: "Personal Jurisdiction", content: "Memo body text." }],
    });
    expect(out).toContain("Plaintiff slipped on a wet floor.");
    expect(out).toContain("Personal Jurisdiction");
    expect(out).toContain("Memo body text.");
    expect(out).toContain("[[memo:m1]]");
  });
});
