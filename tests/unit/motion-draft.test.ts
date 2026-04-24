import { describe, it, expect, vi } from "vitest";
import { draftMotionSection, NoMemosAttachedError } from "@/server/services/motions/draft";

function makeMockAnthropic(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: responseText }] }),
    },
  } as unknown as import("@anthropic-ai/sdk").default;
}

describe("draftMotionSection", () => {
  it("drafts text and extracts memo citations from markers", async () => {
    const client = makeMockAnthropic(
      "The complaint fails to allege minimum contacts [[memo:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]] and therefore personal jurisdiction is lacking.",
    );
    const out = await draftMotionSection(
      {
        motionType: "motion_to_dismiss",
        sectionKey: "argument",
        caseFacts: "Defendant is a NY resident.",
        attachedMemos: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "Personal Jurisdiction", content: "Int'l Shoe test..." }],
      },
      { client },
    );
    expect(out.text).toContain("minimum contacts");
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].memoId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("throws NoMemosAttachedError for argument section with no memos", async () => {
    const client = makeMockAnthropic("unused");
    await expect(
      draftMotionSection(
        { motionType: "motion_to_dismiss", sectionKey: "argument", caseFacts: "facts", attachedMemos: [] },
        { client },
      ),
    ).rejects.toBeInstanceOf(NoMemosAttachedError);
  });

  it("allows facts and conclusion sections without memos", async () => {
    const client = makeMockAnthropic("Plaintiff alleges X.");
    const out = await draftMotionSection(
      { motionType: "motion_to_dismiss", sectionKey: "facts", caseFacts: "facts", attachedMemos: [] },
      { client },
    );
    expect(out.text).toBe("Plaintiff alleges X.");
    expect(out.citations).toEqual([]);
  });
});
