// tests/integration/legal-rag.test.ts
//
// Integration tests for LegalRagService. Mock-DB for persistence; mock
// Anthropic SDK for streaming. Real cache service (with mock DB-backed
// OpinionCacheService). Citation validator + UPL filter run for real.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { db as realDb } from "@/server/db";
import type { CachedOpinion } from "@/server/db/schema/cached-opinions";

// ---------------------------------------------------------------------------
// Mock Anthropic SDK — factory-level so the service picks up our stubbed stream
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => {
  const streamMock = vi.fn();
  class FakeAnthropic {
    messages = { stream: streamMock };
  }
  return { default: FakeAnthropic, __streamMock: streamMock };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anthropicModule = (await import("@anthropic-ai/sdk")) as any;
const streamMock = anthropicModule.__streamMock as ReturnType<typeof vi.fn>;

import { LegalRagService } from "@/server/services/research/legal-rag";
import type { OpinionCacheService } from "@/server/services/research/opinion-cache";

// ---------------------------------------------------------------------------
// Stable UUIDs
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  session: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  opinion1: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
  opinion2: "ffffffff-ffff-4fff-afff-ffffffffffff",
  msg: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
};

// ---------------------------------------------------------------------------
// makeMockDb — chainable, queue-based (matches research-router.test.ts pattern)
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  const limitCalls: number[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        limitCalls.push(n);
        return chain;
      },
      offset: () => chain,
      then: (resolve: (v: SelectResponse) => void, reject: (e: Error) => void) => {
        const v = selectQueue.shift();
        if (v === undefined) {
          reject(new Error("mock db: select queue exhausted"));
          return;
        }
        resolve(v);
      },
    };
    return chain;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeInsertChain = (call: { values?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    returning: async () => {
      const vals = (call.values ?? {}) as Record<string, unknown>;
      return [{ id: ID.msg, createdAt: new Date(), ...vals }];
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUpdateChain = (call: { set?: unknown }): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      set: (s: unknown) => {
        call.set = s;
        return chain;
      },
      where: () => chain,
      then: (resolve: () => void) => resolve(),
    };
    return chain;
  };

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown } = {};
      insertCalls.push(call);
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      updateCalls.push(call);
      return makeUpdateChain(call);
    },
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    limitCalls,
  };
}

// ---------------------------------------------------------------------------
// Fake opinions and stream helpers
// ---------------------------------------------------------------------------
function mockOpinion(overrides: Partial<CachedOpinion> = {}): CachedOpinion {
  return {
    id: ID.opinion1,
    courtlistenerId: 12345,
    citationBluebook: "123 F.3d 456",
    caseName: "Foo v. Bar",
    court: "ca9",
    jurisdiction: "federal",
    courtLevel: "circuit",
    decisionDate: "2020-01-15",
    fullText: "The court held that arbitration clauses are enforceable under 123 F.3d 456.",
    snippet: "arbitration",
    metadata: {},
    firstCachedAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  } as CachedOpinion;
}

type FakeStreamEvent =
  | { type: "content_block_delta"; delta: { type: "text_delta"; text: string } }
  | { type: "content_block_start" | "content_block_stop" | "message_start" | "message_stop" };

function makeStream(
  chunks: string[],
  finalText: string,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 100, output_tokens: 50 },
) {
  async function* gen(): AsyncGenerator<FakeStreamEvent> {
    for (const c of chunks) {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: c } };
    }
  }
  const iter = gen();
  return Object.assign(iter, {
    finalMessage: async () => ({
      content: [{ type: "text", text: finalText }],
      usage,
    }),
  });
}

function makeErrorStream(err: Error) {
  async function* gen(): AsyncGenerator<FakeStreamEvent> {
    throw err;
  }
  const iter = gen();
  return Object.assign(iter, {
    finalMessage: async () => {
      throw err;
    },
  });
}

// ---------------------------------------------------------------------------
// Mock OpinionCacheService — minimal surface for the tests we need
// ---------------------------------------------------------------------------
function makeMockCache(opinions: CachedOpinion[] = []): OpinionCacheService {
  return {
    getOrFetch: vi.fn(async (clId: number) => {
      const found = opinions.find((o) => o.courtlistenerId === clId);
      return found ?? opinions[0]!;
    }),
    getByInternalIds: vi.fn(async (ids: string[]) =>
      opinions.filter((o) => ids.includes(o.id)),
    ),
    upsertSearchHit: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ---------------------------------------------------------------------------
// Helpers for collecting generator output
// ---------------------------------------------------------------------------
interface StreamChunk {
  type: "token" | "done" | "error";
  content?: string;
  messageId?: string;
  flags?: { unverifiedCitations?: string[]; uplViolations?: string[] };
  error?: string;
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  streamMock.mockReset();
});

describe("LegalRagService.askBroad", () => {
  it("yields token chunks then a done chunk with messageId and flags", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]); // history
    enqueueSelect([op]); // latest opinions

    streamMock.mockReturnValueOnce(makeStream(["Hello ", "world", "!"], "Hello world!"));

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "What did the court hold?" }),
    );

    const tokens = chunks.filter((c) => c.type === "token");
    const done = chunks.find((c) => c.type === "done");
    expect(tokens).toHaveLength(3);
    expect(tokens.map((t) => t.content).join("")).toBe("Hello world!");
    expect(done).toBeDefined();
    expect(done!.messageId).toBe(ID.msg);
    expect(done!.flags).toBeDefined();
  });

  it("persists user and assistant messages to DB", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]);
    enqueueSelect([op]);
    streamMock.mockReturnValueOnce(makeStream(["ok"], "The court held in 123 F.3d 456 that X."));

    const svc = new LegalRagService({ db, opinionCache: cache });
    await collect(svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "Q?" }));

    expect(insertCalls).toHaveLength(2);
    const userRow = insertCalls[0]!.values as Record<string, unknown>;
    const assistantRow = insertCalls[1]!.values as Record<string, unknown>;
    expect(userRow.role).toBe("user");
    expect(userRow.content).toBe("Q?");
    expect(userRow.mode).toBe("broad");
    expect(userRow.sessionId).toBe(ID.session);
    expect(userRow.opinionContextIds).toEqual([op.id]);
    expect(assistantRow.role).toBe("assistant");
    expect(assistantRow.mode).toBe("broad");
    expect(assistantRow.opinionContextIds).toEqual([op.id]);
    expect(typeof assistantRow.content).toBe("string");
  });

  it("applies UPL filter before persistence and reports violations", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]);
    enqueueSelect([op]);
    // The model emits "should" — UPL filter rewrites it to "consider".
    streamMock.mockReturnValueOnce(
      makeStream(["You should"], "You should review 123 F.3d 456."),
    );

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "Q?" }),
    );

    const assistantRow = insertCalls[1]!.values as Record<string, unknown>;
    expect(assistantRow.content).toMatch(/consider/i);
    expect(assistantRow.content).not.toMatch(/\bshould\b/i);
    const flags = assistantRow.flags as { uplViolations?: string[] };
    expect(flags.uplViolations).toContain("should");

    const done = chunks.find((c) => c.type === "done");
    expect(done!.flags!.uplViolations).toContain("should");
  });

  it("flags unverified citations in the persisted message", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]);
    enqueueSelect([op]);
    // Claude cites "999 U.S. 1" which is NOT in context (only "123 F.3d 456" is).
    streamMock.mockReturnValueOnce(
      makeStream(["ok"], "Per 999 U.S. 1 the point is moot."),
    );

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "Q?" }),
    );

    const assistantRow = insertCalls[1]!.values as Record<string, unknown>;
    const flags = assistantRow.flags as { unverifiedCitations?: string[] };
    expect(flags.unverifiedCitations).toContain("999 U.S. 1");

    const done = chunks.find((c) => c.type === "done");
    expect(done!.flags!.unverifiedCitations).toContain("999 U.S. 1");
  });

  it("re-prompts once when >=2 unverified citations appear", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]);
    enqueueSelect([op]);
    // First stream: 2 unverified citations.
    streamMock.mockReturnValueOnce(
      makeStream(["bad"], "See 999 U.S. 1 and 888 U.S. 2 for details."),
    );
    // Second stream: 0 unverified (uses valid 123 F.3d 456).
    streamMock.mockReturnValueOnce(
      makeStream(["good"], "The court in 123 F.3d 456 held the clause enforceable."),
    );

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "Q?" }),
    );

    expect(streamMock).toHaveBeenCalledTimes(2);
    const assistantRow = insertCalls[1]!.values as Record<string, unknown>;
    expect(assistantRow.content).toMatch(/123 F\.3d 456/);
    const flags = assistantRow.flags as { unverifiedCitations?: string[] };
    expect(flags.unverifiedCitations).toEqual([]);

    const done = chunks.find((c) => c.type === "done");
    expect(done).toBeDefined();
  });

  it("emits error chunk when >=4 unverified citations remain after re-prompt", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]);
    enqueueSelect([op]);

    const bad =
      "See 999 U.S. 1, 888 U.S. 2, 777 U.S. 3, 666 U.S. 4, and 555 U.S. 5 for details.";
    streamMock.mockReturnValueOnce(makeStream(["bad"], bad));
    streamMock.mockReturnValueOnce(makeStream(["still bad"], bad));

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "Q?" }),
    );

    const last = chunks[chunks.length - 1];
    expect(last.type).toBe("error");
    expect(last.error).toMatch(/ground/i);
    // Only the user message should have been persisted; no assistant insert.
    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0]!.values as Record<string, unknown>).role).toBe("user");
  });

  it("respects topN via the select limit", async () => {
    const { db, enqueueSelect, limitCalls } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]);
    enqueueSelect([op]);
    streamMock.mockReturnValueOnce(makeStream(["x"], "ok"));

    const svc = new LegalRagService({ db, opinionCache: cache });
    await collect(
      svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "Q?", topN: 5 }),
    );

    // The opinions SELECT should have been called with limit(5).
    expect(limitCalls).toContain(5);
  });

  it("yields an error chunk and persists the user message when Claude throws", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const op = mockOpinion();
    const cache = makeMockCache([op]);

    enqueueSelect([]);
    enqueueSelect([op]);
    streamMock.mockReturnValueOnce(makeErrorStream(new Error("network down")));

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askBroad({ sessionId: ID.session, userId: ID.user, question: "Q?" }),
    );

    const last = chunks[chunks.length - 1];
    expect(last.type).toBe("error");
    expect(last.error).toMatch(/network/);
    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0]!.values as Record<string, unknown>).role).toBe("user");
  });
});

describe("LegalRagService.askDeep", () => {
  it("loads a single opinion and persists with opinionId set", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const op = mockOpinion({ id: ID.opinion2, courtlistenerId: 42 });
    const cache = makeMockCache([op]);

    enqueueSelect([]); // history only

    streamMock.mockReturnValueOnce(
      makeStream(["deep"], "The court in 123 F.3d 456 held the clause enforceable."),
    );

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askDeep({
        sessionId: ID.session,
        userId: ID.user,
        opinionInternalId: op.id,
        question: "What rule?",
      }),
    );

    const done = chunks.find((c) => c.type === "done");
    expect(done).toBeDefined();
    expect(insertCalls).toHaveLength(2);
    const assistantRow = insertCalls[1]!.values as Record<string, unknown>;
    expect(assistantRow.role).toBe("assistant");
    expect(assistantRow.mode).toBe("deep");
    expect(assistantRow.opinionId).toBe(op.id);
    expect(assistantRow.opinionContextIds).toEqual([op.id]);
  });

  it("emits an error chunk when the opinion is not found", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const cache = makeMockCache([]); // empty

    enqueueSelect([]); // history

    const svc = new LegalRagService({ db, opinionCache: cache });
    const chunks = await collect(
      svc.askDeep({
        sessionId: ID.session,
        userId: ID.user,
        opinionInternalId: ID.opinion2,
        question: "Q?",
      }),
    );

    const last = chunks[chunks.length - 1];
    expect(last.type).toBe("error");
    expect(last.error).toMatch(/not.?found|missing|found/i);
  });
});
