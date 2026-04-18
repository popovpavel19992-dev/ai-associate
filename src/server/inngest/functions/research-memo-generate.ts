// src/server/inngest/functions/research-memo-generate.ts
//
// Inngest function that runs memo generation in the background (Phase 2.2.3 Task 7).
// The `handleMemoGenerateRequested` handler is exported separately so it can be
// unit-tested with injected deps (db, inngest client, memoSvc, usageGuard).

import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { researchMemos, type ResearchMemo } from "@/server/db/schema/research-memos";
import { MemoGenerationService } from "@/server/services/research/memo-generation";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import { StatuteCacheService } from "@/server/services/research/statute-cache";
import { CourtListenerClient } from "@/server/services/courtlistener/client";
import { GovInfoClient } from "@/server/services/govinfo/client";
import { EcfrClient } from "@/server/services/ecfr/client";
import { UsageGuard } from "@/server/services/research/usage-guard";
import { getEnv } from "@/lib/env";

interface IUsageGuard {
  refundMemo(opts: { userId: string }): Promise<void> | void;
}

interface HandlerDeps {
  db: typeof defaultDb;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inngest: { send: (e: any) => Promise<unknown> | unknown };
  memoSvc: MemoGenerationService;
  usageGuard: IUsageGuard;
}

export async function handleMemoGenerateRequested(
  deps: HandlerDeps,
  input: { memoId: string },
  memo: Pick<ResearchMemo, "id" | "userId" | "title">,
): Promise<void> {
  try {
    await deps.memoSvc.generateAll({ memoId: input.memoId });
    await deps.inngest.send({
      name: "notification.research_memo_ready",
      data: { memoId: memo.id, userId: memo.userId, title: memo.title },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.db
      .update(researchMemos)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(researchMemos.id, input.memoId));
    await deps.usageGuard.refundMemo({ userId: memo.userId });
    await deps.inngest.send({
      name: "notification.research_memo_failed",
      data: { memoId: memo.id, userId: memo.userId, title: memo.title, errorMessage: message },
    });
  }
}

export const researchMemoGenerate = inngest.createFunction(
  {
    id: "research-memo-generate",
    retries: 0,
    triggers: [{ event: "research/memo.generate.requested" }],
  },
  async ({ event, step }) => {
    const { memoId } = event.data as { memoId: string };

    const memo = await step.run("load-memo", async () => {
      const [row] = await defaultDb
        .select()
        .from(researchMemos)
        .where(eq(researchMemos.id, memoId))
        .limit(1);
      if (!row) throw new Error(`Memo ${memoId} not found`);
      return row;
    });

    await step.run("generate", async () => {
      const env = getEnv();
      const cl = new CourtListenerClient({ apiToken: env.COURTLISTENER_API_TOKEN });
      const opinionCache = new OpinionCacheService({ db: defaultDb, courtListener: cl });
      const govinfo = new GovInfoClient({ apiKey: env.GOVINFO_API_KEY });
      const ecfr = new EcfrClient();
      const statuteCache = new StatuteCacheService({ db: defaultDb, govinfo, ecfr });
      const memoSvc = new MemoGenerationService({
        db: defaultDb,
        opinionCache,
        statuteCache,
      });
      const usageGuard = new UsageGuard({ db: defaultDb });
      await handleMemoGenerateRequested(
        { db: defaultDb, inngest, memoSvc, usageGuard },
        { memoId },
        { id: memo.id, userId: memo.userId, title: memo.title },
      );
    });
  },
);
