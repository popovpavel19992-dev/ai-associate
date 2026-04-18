import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import type { NotificationSendEvent } from "@/lib/notification-types";

export interface InngestLike {
  send: (event: { name: string; data: NotificationSendEvent }) => Promise<unknown>;
}

async function lookupCaseName(db: typeof defaultDb, caseId: string): Promise<{ name: string; orgId: string | null }> {
  const [row] = await db
    .select({ name: cases.name, orgId: cases.orgId })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  return { name: row?.name ?? "", orgId: row?.orgId ?? null };
}

/**
 * Factory: returns an `onCaseLink` hook for BookmarkService that fires a
 * `notification/send` Inngest event when a bookmark is linked to a case.
 * Citation is emitted empty for MVP — a later enrichment step can join.
 */
export function makeBookmarkCaseLinkHook(
  inngest: InngestLike,
  db: typeof defaultDb = defaultDb,
): (ctx: { userId: string; bookmarkId: string; opinionId: string; caseId: string }) => Promise<void> {
  return async (ctx) => {
    const { name, orgId } = await lookupCaseName(db, ctx.caseId);
    await inngest.send({
      name: "notification/send",
      data: {
        userId: ctx.userId,
        orgId: orgId ?? undefined,
        type: "research_bookmark_added",
        title: "Case law bookmarked",
        body: name
          ? `An opinion was saved to ${name}`
          : "An opinion was saved to a case",
        caseId: ctx.caseId,
        actionUrl: `/cases/${ctx.caseId}`,
        metadata: { caseName: name, citation: "", opinionId: ctx.opinionId },
      },
    });
  };
}

/**
 * Fires a `notification/send` event when a research session is linked to a case.
 */
export async function notifyResearchSessionLinked(
  inngest: InngestLike,
  args: { sessionId: string; caseId: string; userId: string; sessionTitle?: string },
  db: typeof defaultDb = defaultDb,
): Promise<void> {
  const { name, orgId } = await lookupCaseName(db, args.caseId);
  const sessionTitle = args.sessionTitle ?? "";
  await inngest.send({
    name: "notification/send",
    data: {
      userId: args.userId,
      orgId: orgId ?? undefined,
      type: "research_session_linked",
      title: "Research session linked",
      body: name
        ? `Research session "${sessionTitle}" linked to ${name}`
        : `Research session "${sessionTitle}" linked to a case`,
      caseId: args.caseId,
      actionUrl: `/cases/${args.caseId}`,
      metadata: { caseName: name, sessionTitle, sessionId: args.sessionId },
    },
  });
}
