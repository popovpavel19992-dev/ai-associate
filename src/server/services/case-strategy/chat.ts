import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseStrategyChatMessages } from "@/server/db/schema/case-strategy-chat-messages";
import { caseStrategyRuns } from "@/server/db/schema/case-strategy-runs";
import { caseStrategyRecommendations } from "@/server/db/schema/case-strategy-recommendations";
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";

const SYSTEM = `You are a litigation strategy assistant. The user is a lawyer asking follow-up questions about a specific case. You have access to the latest strategic recommendations and prior chat history. Reference recommendations by their title when relevant. Be direct and specific. This is not legal advice; the lawyer will independently verify before acting.`;

export interface SendChatArgs {
  caseId: string;
  userId: string;
  body: string;
}

export async function sendChatMessage(
  args: SendChatArgs,
): Promise<{ assistantId: string; body: string }> {
  await db.insert(caseStrategyChatMessages).values({
    caseId: args.caseId,
    role: "user",
    body: args.body,
    createdBy: args.userId,
  });

  const [run] = await db
    .select()
    .from(caseStrategyRuns)
    .where(
      and(
        eq(caseStrategyRuns.caseId, args.caseId),
        eq(caseStrategyRuns.status, "succeeded"),
      ),
    )
    .orderBy(desc(caseStrategyRuns.startedAt))
    .limit(1);
  const recs = run
    ? await db
        .select()
        .from(caseStrategyRecommendations)
        .where(eq(caseStrategyRecommendations.runId, run.id))
    : [];

  const history = await db
    .select()
    .from(caseStrategyChatMessages)
    .where(eq(caseStrategyChatMessages.caseId, args.caseId))
    .orderBy(asc(caseStrategyChatMessages.createdAt))
    .limit(20);
  const last10 = history.slice(-10);

  const env = getEnv();
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Latest recommendations:\n${
          recs
            .map((r) => `- [${r.category}/p${r.priority}] ${r.title}: ${r.rationale}`)
            .join("\n") || "(none)"
        }`,
      },
      ...last10.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.body,
      })),
    ],
  });

  const text =
    (response.content as Array<{ type: string; text?: string }>).find(
      (b) => b.type === "text",
    )?.text ?? "";

  const [assistantRow] = await db
    .insert(caseStrategyChatMessages)
    .values({
      caseId: args.caseId,
      role: "assistant",
      body: text,
      referencesRunId: run?.id ?? null,
      createdBy: null,
    })
    .returning({ id: caseStrategyChatMessages.id });

  return { assistantId: assistantRow.id, body: text };
}

export async function listChatMessages(caseId: string, limit = 50) {
  return db
    .select()
    .from(caseStrategyChatMessages)
    .where(eq(caseStrategyChatMessages.caseId, caseId))
    .orderBy(asc(caseStrategyChatMessages.createdAt))
    .limit(limit);
}
