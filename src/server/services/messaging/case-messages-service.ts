// src/server/services/messaging/case-messages-service.ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseMessages } from "@/server/db/schema/case-messages";
import { caseMessageReads } from "@/server/db/schema/case-message-reads";
import { documents } from "@/server/db/schema/documents";
import { cases } from "@/server/db/schema/cases";
import { inngest as defaultInngest } from "@/server/inngest/client";

export interface CaseMessagesServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export interface SendInput {
  caseId: string;
  lawyerUserId: string;
  body: string;
  documentId?: string;
}

export class CaseMessagesService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: CaseMessagesServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  async send(input: SendInput): Promise<{ messageId: string }> {
    if (input.documentId) {
      const [doc] = await this.db
        .select({ id: documents.id, caseId: documents.caseId })
        .from(documents)
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (doc.caseId !== input.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Document is not in this case" });
      }
    }
    const [row] = await this.db
      .insert(caseMessages)
      .values({
        caseId: input.caseId,
        authorType: "lawyer",
        lawyerAuthorId: input.lawyerUserId,
        portalAuthorId: null,
        body: input.body,
        documentId: input.documentId ?? null,
      })
      .returning();
    await this.inngest.send({
      name: "messaging/case_message.created",
      data: {
        messageId: row.id,
        caseId: input.caseId,
        authorType: "lawyer",
        authorUserId: input.lawyerUserId,
      },
    });
    return { messageId: row.id };
  }

  async markRead(input: { caseId: string; userId: string }): Promise<void> {
    const now = new Date();
    await this.db
      .insert(caseMessageReads)
      .values({
        caseId: input.caseId,
        userId: input.userId,
        lastReadAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [caseMessageReads.caseId, caseMessageReads.userId],
        set: { lastReadAt: now, updatedAt: now },
      });
  }

  /** For sidebar badge: count of cases (in user's org) with unread client messages. */
  async unreadByCase(input: { userId: string; orgId: string | null }): Promise<{
    count: number;
    byCase: Array<{ caseId: string; count: number; lastMessageAt: Date }>;
  }> {
    // Single aggregation. Considers cases in the user's org (or the user's own cases if no org).
    const orgClause = input.orgId
      ? sql`${cases.orgId} = ${input.orgId}`
      : sql`${cases.userId} = ${input.userId}`;
    const rows = await this.db.execute<{
      case_id: string;
      unread_count: number;
      last_message_at: Date;
    }>(sql`
      SELECT
        m.case_id,
        COUNT(*)::int AS unread_count,
        MAX(m.created_at) AS last_message_at
      FROM ${caseMessages} m
      JOIN ${cases} c ON c.id = m.case_id
      WHERE ${orgClause}
        AND m.author_type = 'client'
        AND m.created_at > COALESCE(
          (SELECT last_read_at FROM ${caseMessageReads} r
           WHERE r.case_id = m.case_id AND r.user_id = ${input.userId}),
          to_timestamp(0)
        )
      GROUP BY m.case_id
    `);
    const list = ((rows as any).rows ?? rows) as Array<{
      case_id: string;
      unread_count: number;
      last_message_at: Date;
    }>;
    const byCase = list.map((r) => ({
      caseId: r.case_id,
      count: Number(r.unread_count),
      lastMessageAt: r.last_message_at,
    }));
    return { count: byCase.length, byCase };
  }
}
