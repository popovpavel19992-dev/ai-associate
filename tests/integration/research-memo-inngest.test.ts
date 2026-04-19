import { describe, it, expect, vi } from "vitest";
import { handleMemoGenerateRequested } from "@/server/inngest/functions/research-memo-generate";

describe("handleMemoGenerateRequested", () => {
  it("flips status to 'ready' on success and dispatches notification", async () => {
    const generateAll = vi.fn().mockResolvedValue({
      status: "ready",
      sections: [],
      flags: { unverifiedCitations: [], uplViolations: [] },
      tokenUsage: { input_tokens: 50, output_tokens: 10 },
    });
    const inngest = { send: vi.fn() };
    const memo = { id: "m1", userId: "u1", title: "T" };
    const db = { update: () => ({ set: () => ({ where: () => Promise.resolve() }) }) } as any;
    const usageGuard = { refundMemo: vi.fn() };
    const memoSvc = { generateAll } as any;
    await handleMemoGenerateRequested({ db, inngest, memoSvc, usageGuard }, { memoId: "m1" }, memo as any);
    expect(generateAll).toHaveBeenCalledWith({ memoId: "m1" });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notification.research_memo_ready" }),
    );
    expect(usageGuard.refundMemo).not.toHaveBeenCalled();
  });

  it("refunds + dispatches failure notification on error", async () => {
    const generateAll = vi.fn().mockRejectedValue(new Error("API down"));
    const inngest = { send: vi.fn() };
    const memo = { id: "m1", userId: "u1", title: "T" };
    const db = { update: () => ({ set: () => ({ where: () => Promise.resolve() }) }) } as any;
    const usageGuard = { refundMemo: vi.fn() };
    const memoSvc = { generateAll } as any;
    await handleMemoGenerateRequested({ db, inngest, memoSvc, usageGuard }, { memoId: "m1" }, memo as any);
    expect(usageGuard.refundMemo).toHaveBeenCalledWith({ userId: "u1" });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notification.research_memo_failed" }),
    );
  });
});
