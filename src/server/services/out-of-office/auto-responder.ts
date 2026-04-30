// src/server/services/out-of-office/auto-responder.ts
//
// Phase 3.14 — Inbound-reply hook. When a new human reply lands, fire an
// auto-response if the outreach owner is currently OOO and we haven't already
// responded to this sender during this period.

import { eq } from "drizzle-orm";
import type { db as defaultDb } from "@/server/db";
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { users } from "@/server/db/schema/users";
import {
  getActiveForUser,
  shouldRespondTo,
  recordAutoResponseSent,
  type Db,
} from "./service";
import { sendEmail as defaultSendEmail } from "@/server/services/email";

export interface AutoResponderDeps {
  db?: Db;
  sendEmail?: typeof defaultSendEmail;
  now?: () => Date;
}

export interface MaybeSendResult {
  sent: boolean;
  reason?:
    | "no-reply"
    | "no-outreach"
    | "no-owner"
    | "no-active-ooo"
    | "already-responded"
    | "send-failed";
  wasEmergency?: boolean;
}

const URGENT_REGEX = /\b(urgent|emergency|asap)\b/i;

export function isEmergency(input: { subject?: string | null; body?: string | null }): boolean {
  const hay = `${input.subject ?? ""}\n${input.body ?? ""}`;
  return URGENT_REGEX.test(hay);
}

export interface MergeContext {
  returnDate: string;
  coverageName: string;
  coverageEmail: string;
  firmPhone: string;
  senderName?: string;
  senderEmail?: string;
}

/** Renders {{tag}} placeholders. Unknown tags pass through unchanged. */
export function renderTemplate(template: string, ctx: MergeContext): string {
  const map: Record<string, string> = {
    return_date: ctx.returnDate,
    coverage_name: ctx.coverageName,
    coverage_email: ctx.coverageEmail,
    firm_phone: ctx.firmPhone,
    sender_name: ctx.senderName ?? "",
    sender_email: ctx.senderEmail ?? "",
  };
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, key: string) => {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : m;
  });
}

export const DEFAULT_AUTO_RESPONSE_BODY =
  "Thank you for your message. I am currently out of the office and will return on {{return_date}}. " +
  "For urgent matters, please contact {{coverage_name}} at {{coverage_email}} or our office at {{firm_phone}}. " +
  "I will respond to your message upon my return.";

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bodyToHtml(plain: string): string {
  return plain
    .split(/\n{2,}/)
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function maybeSendAutoResponse(
  deps: AutoResponderDeps,
  replyId: string,
): Promise<MaybeSendResult> {
  const db = (deps.db ?? (await import("@/server/db")).db) as Db;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const now = deps.now ? deps.now() : new Date();

  // 1. Load reply
  const [reply] = await db
    .select()
    .from(caseEmailReplies)
    .where(eq(caseEmailReplies.id, replyId))
    .limit(1);
  if (!reply) return { sent: false, reason: "no-reply" };

  // 2. Load outreach + owner. If outreach has parentReplyId (chained reply),
  //    walk back to find the original outreach owner.
  let [outreach] = await db
    .select()
    .from(caseEmailOutreach)
    .where(eq(caseEmailOutreach.id, reply.outreachId))
    .limit(1);
  if (!outreach) return { sent: false, reason: "no-outreach" };

  let guard = 0;
  while (outreach.parentReplyId && guard < 5) {
    const [parentReply] = await db
      .select()
      .from(caseEmailReplies)
      .where(eq(caseEmailReplies.id, outreach.parentReplyId))
      .limit(1);
    if (!parentReply) break;
    const [parentOutreach] = await db
      .select()
      .from(caseEmailOutreach)
      .where(eq(caseEmailOutreach.id, parentReply.outreachId))
      .limit(1);
    if (!parentOutreach) break;
    outreach = parentOutreach;
    guard++;
  }

  const ownerId = outreach.sentBy;
  if (!ownerId) return { sent: false, reason: "no-owner" };

  // 3. Active OOO?
  const ooo = await getActiveForUser(db, ownerId, now);
  if (!ooo) return { sent: false, reason: "no-active-ooo" };

  // 4. Dedup
  const allow = await shouldRespondTo(db, ooo.id, reply.fromEmail);
  if (!allow) return { sent: false, reason: "already-responded" };

  // 5. Emergency detection
  const wasEmergency = isEmergency({ subject: reply.subject, body: reply.bodyText });

  // 6. Resolve coverage info
  let coverageName = "our office";
  let coverageEmail = "";
  if (ooo.coverageUserId) {
    const [coverage] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, ooo.coverageUserId))
      .limit(1);
    if (coverage) {
      coverageName = coverage.name;
      coverageEmail = coverage.email;
    }
  }

  const firmPhone = process.env.FIRM_PHONE ?? "";
  const returnDateObj = new Date(`${ooo.endDate}T00:00:00Z`);
  const returnDate = returnDateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const ctx: MergeContext = {
    returnDate,
    coverageName,
    coverageEmail,
    firmPhone,
    senderName: reply.fromName ?? undefined,
    senderEmail: reply.fromEmail,
  };

  const rawBody =
    wasEmergency && ooo.emergencyKeywordResponse
      ? ooo.emergencyKeywordResponse
      : ooo.autoResponseBody;
  const bodyText = renderTemplate(rawBody, ctx);
  const subject = ooo.autoResponseSubject || "Out of Office Auto-Reply";

  // 7. Send email with thread continuation
  try {
    const threadHeaders = reply.messageId
      ? {
          inReplyTo: reply.messageId,
          references: [reply.inReplyTo, reply.messageId].filter(
            (s): s is string => typeof s === "string" && s.length > 0,
          ),
        }
      : undefined;

    await sendEmail({
      to: reply.fromEmail,
      subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${reply.subject}`,
      html: bodyToHtml(bodyText),
      threadHeaders,
    });
  } catch (e) {
    console.error("[ooo-auto-responder] sendEmail failed", e);
    return { sent: false, reason: "send-failed", wasEmergency };
  }

  // 8. Log (UNIQUE protects against races)
  const result = await recordAutoResponseSent(db, {
    oooId: ooo.id,
    replyId: reply.id,
    recipientEmail: reply.fromEmail,
    wasEmergency,
  });
  return { sent: result.inserted, wasEmergency };
}
