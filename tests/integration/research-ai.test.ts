// tests/integration/research-ai.test.ts
//
// Integration tests for research.askBroad / askDeep / getUsage procedures.
// Mock DB + mock LegalRagService + mock CourtListenerClient.
//
// The askBroad/askDeep procedures delegate to exported helpers
// (runAskBroad / runAskDeep) so tests can drive the generator directly
// without spinning up a tRPC subscription transport.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { db as realDb } from "@/server/db";

// Mock CourtListenerClient at module level so the router's internal
// `makeRag` fallback never instantiates a real HTTP client. (The tests
// below override `rag` via deps, but safety first.)
vi.mock("@/server/services/courtlistener/client", () => ({
  CourtListenerClient: vi.fn(),
  CourtListenerError: class CourtListenerError extends Error {},
  CourtListenerRateLimitError: class CourtListenerRateLimitError extends Error {},
}));

// Mock the LegalRagService module so the default `makeRag` path also
// stays inert in case a test forgets to inject `rag`.
vi.mock("@/server/services/research/legal-rag", () => {
  class StubLegalRagService {
    // eslint-disable-next-line require-yield
    async *askBroad(): AsyncGenerator<unknown> {
      return;
    }
    // eslint-disable-next-line require-yield
    async *askDeep(): AsyncGenerator<unknown> {
      return;
    }
  }
  return { LegalRagService: StubLegalRagService };
});

import {
  researchRouter,
  runAskBroad,
  runAskDeep,
  type AskDeps,
} from "@/server/trpc/routers/research";
import { UsageGuard } from "@/server/services/research/usage-guard";

// ---------------------------------------------------------------------------
// Stable UUIDs
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  session: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  opinion: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
};

// ---------------------------------------------------------------------------
// makeMockDb — chainable, queue-based (same shape as research-router.test.ts).
// Supports: select (via enqueueSelect), insert upsert (returns qaCount),
// update (tracked), delete.
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb(opts?: { upsertQaCount?: number }) {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown; onConflictCfg?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  const deleteCalls: unknown[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      limit: () => chain,
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
  const makeInsertChain = (call: { values?: unknown; onConflictCfg?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    onConflictDoUpdate: (cfg: unknown) => {
      call.onConflictCfg = cfg;
      return makeInsertChain(call);
    },
    returning: async () => {
      // Only the usage-guard upsert path hits insert in these tests.
      // Return the configured qaCount so we can drive over-limit scenarios.
      return [{ qaCount: opts?.upsertQaCount ?? 1 }];
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
      returning: async () => [{ qaCount: 0 }],
      then: (resolve: () => void) => resolve(),
    };
    return chain;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeDeleteChain = (): any => ({
    where: () => makeDeleteChain(),
    then: (resolve: () => void) => {
      deleteCalls.push({});
      resolve();
    },
  });

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown; onConflictCfg?: unknown } = {};
      insertCalls.push(call);
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      updateCalls.push(call);
      return makeUpdateChain(call);
    },
    delete: () => makeDeleteChain(),
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    deleteCalls,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type MockUser = { id: string; orgId: string | null; role: string | null; plan: string };
type Ctx = { db: typeof realDb; user: MockUser };

function makeCtx(
  db: typeof realDb,
  plan: "trial" | "solo" = "trial",
): Ctx {
  return { db, user: { id: ID.user, orgId: null, role: "owner", plan } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = (ctx: Ctx) => researchRouter.createCaller(ctx as unknown as any);

type Chunk =
  | { type: "token"; content: string }
  | { type: "done"; messageId?: string }
  | { type: "error"; error: string };

function makeStubRag(opts: {
  kind?: "broad" | "deep" | "both";
  chunks?: Chunk[];
  throwOnCall?: boolean;
}) {
  const askBroad = vi.fn(
    opts.throwOnCall
      ? () => {
          throw new Error("rag exploded");
        }
      : async function* () {
          for (const c of opts.chunks ?? []) yield c;
        },
  );
  const askDeep = vi.fn(
    opts.throwOnCall
      ? () => {
          throw new Error("rag exploded");
        }
      : async function* () {
          for (const c of opts.chunks ?? []) yield c;
        },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rag = { askBroad, askDeep } as any;
  return { rag, askBroad, askDeep };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// askBroad
// ---------------------------------------------------------------------------
describe("research.askBroad (via runAskBroad helper)", () => {
  it("streams token/token/done chunks on the happy path", async () => {
    const { db } = makeMockDb({ upsertQaCount: 1 });
    const ctx = makeCtx(db, "trial");
    const { rag, askBroad } = makeStubRag({
      chunks: [
        { type: "token", content: "Hello " },
        { type: "token", content: "world" },
        { type: "done", messageId: "msg-1" },
      ],
    });

    const chunks: Chunk[] = [];
    for await (const c of runAskBroad(
      ctx,
      { sessionId: ID.session, question: "What is arbitration?", topN: 5 },
      { db, rag } as AskDeps,
    )) {
      chunks.push(c as Chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: "token", content: "Hello " });
    expect(chunks[1]).toEqual({ type: "token", content: "world" });
    expect(chunks[2]).toMatchObject({ type: "done", messageId: "msg-1" });
    expect(askBroad).toHaveBeenCalledTimes(1);
    expect(askBroad).toHaveBeenCalledWith({
      sessionId: ID.session,
      userId: ID.user,
      question: "What is arbitration?",
      topN: 5,
    });
  });

  it("throws TOO_MANY_REQUESTS when usage limit exceeded on trial", async () => {
    // trial → starter → limit 50. upsert returns 51 → over limit.
    const { db } = makeMockDb({ upsertQaCount: 51 });
    const ctx = makeCtx(db, "trial");
    const { rag, askBroad } = makeStubRag({ chunks: [] });

    const gen = runAskBroad(
      ctx,
      { sessionId: ID.session, question: "q" },
      { db, rag } as AskDeps,
    );

    await expect(gen.next()).rejects.toMatchObject({
      name: "TRPCError",
      code: "TOO_MANY_REQUESTS",
    });
    expect(askBroad).not.toHaveBeenCalled();
  });

  it("refunds usage when the stream yields an error chunk", async () => {
    const { db, updateCalls } = makeMockDb({ upsertQaCount: 1 });
    const ctx = makeCtx(db, "trial");
    const { rag } = makeStubRag({
      chunks: [
        { type: "token", content: "partial " },
        { type: "error", error: "boom" },
      ],
    });

    const chunks: Chunk[] = [];
    for await (const c of runAskBroad(
      ctx,
      { sessionId: ID.session, question: "q" },
      { db, rag } as AskDeps,
    )) {
      chunks.push(c as Chunk);
    }

    expect(chunks[chunks.length - 1]).toMatchObject({ type: "error" });
    // Exactly one update call — the refund.
    expect(updateCalls).toHaveLength(1);
  });

  it("refunds usage when LegalRag throws synchronously", async () => {
    const { db, updateCalls } = makeMockDb({ upsertQaCount: 1 });
    const ctx = makeCtx(db, "trial");
    const { rag } = makeStubRag({ throwOnCall: true });

    await expect(
      (async () => {
        for await (const _ of runAskBroad(
          ctx,
          { sessionId: ID.session, question: "q" },
          { db, rag } as AskDeps,
        )) {
          // drain
        }
      })(),
    ).rejects.toThrow("rag exploded");

    expect(updateCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// askDeep
// ---------------------------------------------------------------------------
describe("research.askDeep (via runAskDeep helper)", () => {
  it("calls askDeep (not askBroad) and passes chunks through", async () => {
    const { db } = makeMockDb({ upsertQaCount: 1 });
    const ctx = makeCtx(db, "solo");
    const { rag, askBroad, askDeep } = makeStubRag({
      chunks: [
        { type: "token", content: "deep " },
        { type: "done", messageId: "msg-2" },
      ],
    });

    const chunks: Chunk[] = [];
    for await (const c of runAskDeep(
      ctx,
      {
        sessionId: ID.session,
        opinionInternalId: ID.opinion,
        question: "Narrow it down",
      },
      { db, rag } as AskDeps,
    )) {
      chunks.push(c as Chunk);
    }

    expect(askBroad).not.toHaveBeenCalled();
    expect(askDeep).toHaveBeenCalledTimes(1);
    expect(askDeep).toHaveBeenCalledWith({
      sessionId: ID.session,
      userId: ID.user,
      opinionInternalId: ID.opinion,
      question: "Narrow it down",
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ type: "done", messageId: "msg-2" });
  });
});

// ---------------------------------------------------------------------------
// getUsage
// ---------------------------------------------------------------------------
describe("research.getUsage", () => {
  it("returns {used, limit} based on the current user's plan", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx = makeCtx(db, "solo");

    // UsageGuard.getCurrentUsage issues one SELECT against researchUsage.
    enqueueSelect([{ qaCount: 17 }]);

    const result = await caller(ctx).getUsage();
    expect(result).toEqual({ used: 17, limit: 500 });
  });

  it("returns {used: 0, limit: 50} when no usage row exists for trial plan", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx = makeCtx(db, "trial");

    enqueueSelect([]); // no usage row yet

    const result = await caller(ctx).getUsage();
    expect(result).toEqual({ used: 0, limit: 50 });
  });
});

// ---------------------------------------------------------------------------
// Sanity: UsageGuard is imported and used transport-side (not only
// constructed inside the helper). This guards against accidental refactors
// that drop the transport-layer guard.
// ---------------------------------------------------------------------------
describe("transport-layer guard wiring", () => {
  it("runAskBroad uses UsageGuard to gate access before calling rag", async () => {
    const { db } = makeMockDb({ upsertQaCount: 1 });
    const ctx = makeCtx(db, "trial");
    const { rag, askBroad } = makeStubRag({
      chunks: [{ type: "done", messageId: "ok" }],
    });

    // Inject a real UsageGuard backed by the mock db; verify it's consulted
    // by confirming the insert (upsert) happened before askBroad ran.
    const guard = new UsageGuard({ db });
    const checkSpy = vi.spyOn(guard, "checkAndIncrementQa");

    const chunks: Chunk[] = [];
    for await (const c of runAskBroad(
      ctx,
      { sessionId: ID.session, question: "q" },
      { db, rag, usageGuard: guard } as AskDeps,
    )) {
      chunks.push(c as Chunk);
    }

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy).toHaveBeenCalledWith({ userId: ID.user, plan: "starter" });
    expect(askBroad).toHaveBeenCalledTimes(1);
    // Order: guard check resolved before rag invocation.
    expect(checkSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      askBroad.mock.invocationCallOrder[0]!,
    );
  });
});

// Keep TRPCError import alive for readers — referenced in expectations.
void TRPCError;
