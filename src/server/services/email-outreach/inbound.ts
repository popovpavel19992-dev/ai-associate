import { eq, and } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailReplies, type NewCaseEmailReply } from "@/server/db/schema/case-email-replies";
import { caseEmailReplyAttachments, type NewCaseEmailReplyAttachment } from "@/server/db/schema/case-email-reply-attachments";
import { notifications } from "@/server/db/schema/notifications";
import { notificationPreferences } from "@/server/db/schema/notification-preferences";
import { classifyReplyKind, isBounce } from "./classify";
import { isSenderMismatch } from "./sender-match";
import { sanitizeHtml } from "./render";
import { randomUUID } from "crypto";

const REPLY_DOMAIN = process.env.REPLY_DOMAIN ?? "reply.clearterms.ai";
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
const INLINE_IMAGE_SKIP_BYTES = 10 * 1024;
const ALLOWED_CONTENT_TYPE = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml)\..*|image\/(png|jpeg|jpg|gif|webp)|text\/plain|text\/csv|application\/zip)$/i;

export const REPLY_TO_REGEX = /^case-email-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@reply\.clearterms\.ai$/i;

export function buildReplyToAddress(outreachId: string): string {
  return `case-email-${outreachId}@${REPLY_DOMAIN}`;
}

export function parseOutreachIdFromTo(toAddresses: string[]): string | null {
  for (const addr of toAddresses) {
    const m = addr.match(REPLY_TO_REGEX);
    if (m) return m[1];
  }
  return null;
}

export interface InboundPayload {
  eventId: string;
  to: string[];
  from: { email: string; name?: string };
  subject: string;
  text?: string;
  html?: string;
  headers: Record<string, string | undefined>;
  messageId?: string;
  inReplyTo?: string;
  receivedAt: Date;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: Buffer;
    contentId?: string;
  }>;
}

export interface InboundResult {
  status: "ok" | "duplicate" | "unrouted" | "no-parent" | "bounced";
  replyId?: string;
}

export interface EmailInboundServiceDeps {
  db?: typeof defaultDb;
  putObject?: (key: string, body: Buffer, contentType: string) => Promise<void>;
  enqueueExternalEmail?: (opts: { userId: string; replyId: string }) => Promise<void>;
}

export class EmailInboundService {
  private readonly db: typeof defaultDb;
  private readonly putObject?: EmailInboundServiceDeps["putObject"];
  private readonly enqueueExternalEmail?: EmailInboundServiceDeps["enqueueExternalEmail"];

  constructor(deps: EmailInboundServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.putObject = deps.putObject;
    this.enqueueExternalEmail = deps.enqueueExternalEmail;
  }

  async ingest(payload: InboundPayload): Promise<InboundResult> {
    // 1. idempotency
    const existing = await this.db
      .select({ id: caseEmailReplies.id })
      .from(caseEmailReplies)
      .where(eq(caseEmailReplies.resendEventId, payload.eventId))
      .limit(1);
    if (existing.length > 0) return { status: "duplicate", replyId: existing[0].id };

    // 2. routing
    const outreachId = parseOutreachIdFromTo(payload.to);
    if (!outreachId) return { status: "unrouted" };

    // 3. lookup outreach
    const [outreach] = await this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        sentBy: caseEmailOutreach.sentBy,
        recipientEmail: caseEmailOutreach.recipientEmail,
        subject: caseEmailOutreach.subject,
      })
      .from(caseEmailOutreach)
      .where(eq(caseEmailOutreach.id, outreachId))
      .limit(1);
    if (!outreach) return { status: "no-parent" };

    // 4. bounce path
    if (isBounce({ from: payload.from.email, subject: payload.subject, headers: payload.headers })) {
      const reason = (payload.text ?? payload.subject).slice(0, 2000);
      await this.db
        .update(caseEmailOutreach)
        .set({ status: "bounced", bounceReason: reason, bouncedAt: new Date() })
        .where(eq(caseEmailOutreach.id, outreach.id));
      if (outreach.sentBy) {
        await this.db.insert(notifications).values({
          userId: outreach.sentBy,
          type: "email_bounced",
          title: `Email bounced`,
          body: `Delivery failed for email "${outreach.subject}"`,
          caseId: outreach.caseId,
          dedupKey: `bounce:${outreach.id}`,
        });
      }
      return { status: "bounced" };
    }

    const replyKind = classifyReplyKind({ headers: payload.headers, subject: payload.subject });
    const senderMismatch = isSenderMismatch(payload.from.email, outreach.recipientEmail);
    const rawHtml = payload.html ?? `<p>${(payload.text ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</p>`;
    const bodyHtml = sanitizeHtml(rawHtml);

    const replyId = randomUUID();
    const accepted: Array<{ key: string; filename: string; contentType: string; size: number; content: Buffer }> = [];
    let spent = 0;
    for (const a of payload.attachments ?? []) {
      if (spent + a.size > MAX_ATTACHMENTS_BYTES) break;
      if (a.contentId && a.contentType.startsWith("image/") && a.size < INLINE_IMAGE_SKIP_BYTES) continue;
      if (!ALLOWED_CONTENT_TYPE.test(a.contentType)) continue;
      accepted.push({
        key: `email-replies/${replyId}/${a.filename}`,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        content: a.content,
      });
      spent += a.size;
    }

    if (accepted.length > 0) {
      if (!this.putObject) throw new Error("putObject dep not injected");
      for (const a of accepted) {
        await this.putObject(a.key, a.content, a.contentType);
      }
    }

    const newReply: NewCaseEmailReply = {
      id: replyId,
      outreachId: outreach.id,
      caseId: outreach.caseId,
      replyKind,
      fromEmail: payload.from.email,
      fromName: payload.from.name ?? null,
      subject: payload.subject,
      bodyText: payload.text ?? null,
      bodyHtml,
      senderMismatch,
      messageId: payload.messageId ?? null,
      inReplyTo: payload.inReplyTo ?? null,
      resendEventId: payload.eventId,
      receivedAt: payload.receivedAt,
    };
    await this.db.insert(caseEmailReplies).values(newReply);

    if (accepted.length > 0) {
      const rows: NewCaseEmailReplyAttachment[] = accepted.map((a) => ({
        replyId,
        s3Key: a.key,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.size,
      }));
      await this.db.insert(caseEmailReplyAttachments).values(rows);
    }

    if (outreach.sentBy) {
      try {
        await this.db.insert(notifications).values({
          userId: outreach.sentBy,
          type: "email_reply_received",
          title: replyKind === "auto_reply" ? `Auto-reply received` : `Client replied`,
          body: `${payload.from.name ?? payload.from.email}: ${(payload.text ?? "").slice(0, 140)}`,
          caseId: outreach.caseId,
          dedupKey: `reply:${replyId}`,
        });
      } catch (e) {
        console.error("[inbound] notification insert failed", e);
      }

      if (replyKind === "human" && this.enqueueExternalEmail) {
        const prefs = await this.db
          .select({ enabled: notificationPreferences.enabled })
          .from(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.userId, outreach.sentBy),
              eq(notificationPreferences.notificationType, "email_reply_received"),
              eq(notificationPreferences.channel, "email"),
            ),
          )
          .limit(1);
        if (prefs[0]?.enabled === true) {
          try {
            await this.enqueueExternalEmail({ userId: outreach.sentBy, replyId });
          } catch (e) {
            console.error("[inbound] external email enqueue failed", e);
          }
        }
      }
    }

    return { status: "ok", replyId };
  }
}
