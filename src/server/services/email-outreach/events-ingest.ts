// src/server/services/email-outreach/events-ingest.ts
import { eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailOutreachEvents, type NewCaseEmailOutreachEvent } from "@/server/db/schema/case-email-outreach-events";
import { notifications } from "@/server/db/schema/notifications";

export type EventType = "delivered" | "opened" | "clicked" | "complained";

export interface EventPayload {
  eventId: string;
  resendEmailId: string;
  eventType: EventType | string;
  eventAt: Date;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  status: "ok" | "duplicate" | "no-parent" | "skipped";
}

export interface EmailEventsIngestServiceDeps {
  db?: typeof defaultDb;
}

const ALLOWED_TYPES = new Set<EventType>(["delivered", "opened", "clicked", "complained"]);

export class EmailEventsIngestService {
  private readonly db: typeof defaultDb;

  constructor(deps: EmailEventsIngestServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
  }

  async ingest(payload: EventPayload): Promise<IngestResult> {
    const existing = await this.db
      .select({ id: caseEmailOutreachEvents.id })
      .from(caseEmailOutreachEvents)
      .where(eq(caseEmailOutreachEvents.resendEventId, payload.eventId))
      .limit(1);
    if (existing.length > 0) return { status: "duplicate" };

    const [outreach] = await this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        sentBy: caseEmailOutreach.sentBy,
      })
      .from(caseEmailOutreach)
      .where(eq(caseEmailOutreach.resendId, payload.resendEmailId))
      .limit(1);
    if (!outreach) return { status: "no-parent" };

    if (!ALLOWED_TYPES.has(payload.eventType as EventType)) {
      return { status: "skipped" };
    }
    const eventType = payload.eventType as EventType;

    const newEvent: NewCaseEmailOutreachEvent = {
      outreachId: outreach.id,
      eventType,
      eventAt: payload.eventAt,
      metadata: payload.metadata ?? null,
      resendEventId: payload.eventId,
    };
    await this.db.insert(caseEmailOutreachEvents).values(newEvent);

    const tsParam = sql.param(payload.eventAt, caseEmailOutreach.deliveredAt);
    if (eventType === "delivered") {
      await this.db
        .update(caseEmailOutreach)
        .set({ deliveredAt: sql`COALESCE(${caseEmailOutreach.deliveredAt}, ${tsParam})` })
        .where(eq(caseEmailOutreach.id, outreach.id));
    } else if (eventType === "opened") {
      await this.db
        .update(caseEmailOutreach)
        .set({
          openCount: sql`${caseEmailOutreach.openCount} + 1`,
          firstOpenedAt: sql`COALESCE(${caseEmailOutreach.firstOpenedAt}, ${tsParam})`,
          lastOpenedAt: payload.eventAt,
        })
        .where(eq(caseEmailOutreach.id, outreach.id));
    } else if (eventType === "clicked") {
      await this.db
        .update(caseEmailOutreach)
        .set({
          clickCount: sql`${caseEmailOutreach.clickCount} + 1`,
          firstClickedAt: sql`COALESCE(${caseEmailOutreach.firstClickedAt}, ${tsParam})`,
          lastClickedAt: payload.eventAt,
        })
        .where(eq(caseEmailOutreach.id, outreach.id));
    } else if (eventType === "complained") {
      await this.db
        .update(caseEmailOutreach)
        .set({ complainedAt: payload.eventAt })
        .where(eq(caseEmailOutreach.id, outreach.id));
      if (outreach.sentBy) {
        try {
          await this.db.insert(notifications).values({
            userId: outreach.sentBy,
            type: "email_complained",
            title: "Email marked as spam",
            body: `Recipient marked a sent email as spam`,
            caseId: outreach.caseId,
            dedupKey: `complaint:${outreach.id}`,
          });
        } catch (e) {
          console.error("[events-ingest] notification insert failed", e);
        }
      }
    }

    return { status: "ok" };
  }
}
