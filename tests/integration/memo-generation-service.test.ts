// tests/integration/memo-generation-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { MemoGenerationService } from "@/server/services/research/memo-generation";

function makeAnthropicMock() {
  function makeStream() {
    const gen = (async function* () {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "The court held in 410 U.S. 113. " } };
      yield { type: "message_stop" };
    })();
    return {
      [Symbol.asyncIterator]: () => gen,
      finalMessage: async () => ({
        content: [{ type: "text", text: "The court held in 410 U.S. 113. " }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      abort: () => {},
    };
  }
  const messages = {
    stream: vi.fn().mockImplementation(() => makeStream()),
  };
  return { messages } as any;
}

function makeMockDb() {
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { table: string; set: unknown }[] = [];
  const selects: { rows: any[] }[] = [];
  const db = {
    insert: (t: any) => ({
      values: (v: any) => ({
        returning: async () => [{ id: "memo-1", ...v }],
        onConflictDoNothing: () => ({ returning: async () => [{ id: "memo-1", ...v }] }),
      }),
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: () => ({ returning: async () => [{ id: "memo-1", ...s }] }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selects.shift()?.rows ?? []) }),
      }),
    }),
    transaction: async (fn: (tx: any) => Promise<void>) => {
      await fn(db);
    },
    enqueueSelect: (rows: any[]) => selects.push({ rows }),
  } as any;
  return { db, inserts, updates };
}

describe("MemoGenerationService.generateAll", () => {
  it("generates 4 sections in parallel and persists them", async () => {
    const { db } = makeMockDb();
    db.enqueueSelect([{ id: "memo-1", memoQuestion: "Q?", contextOpinionIds: ["op1"], contextStatuteIds: [] }]);
    const anthropic = makeAnthropicMock();
    const opinionCache = {
      getByInternalIds: vi.fn().mockResolvedValue([
        { id: "op1", citationBluebook: "410 U.S. 113", fullText: "...", caseName: "Roe v. Wade" },
      ]),
    };
    const statuteCache = {
      getByInternalIds: vi.fn().mockResolvedValue([]),
    };
    const svc = new MemoGenerationService({ db, anthropic, opinionCache: opinionCache as any, statuteCache: statuteCache as any });
    const result = await svc.generateAll({ memoId: "memo-1" });
    expect(result.status).toBe("ready");
    expect(result.sections).toHaveLength(4);
    expect(result.sections.map((s) => s.section_type).sort()).toEqual([
      "application", "conclusion", "issue", "rule",
    ]);
  });
});
