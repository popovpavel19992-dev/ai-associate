// src/server/inngest/functions/email-reply-notification.ts
//
// Sends an optional external notification email to the assigned lawyer when a client
// replies to an outreach email. Triggered by enqueueExternalEmail in the inbound webhook.

import { inngest } from "@/server/inngest/client";
import { db } from "@/server/db";
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { users } from "@/server/db/schema/users";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/server/services/email";

export const emailReplyNotification = inngest.createFunction(
  { id: "email-reply-notification", retries: 1, triggers: [{ event: "messaging/email_reply.received" }] },
  async ({ event, step }) => {
    const { userId, replyId } = event.data as { userId: string; replyId: string };

    const ctx = await step.run("load", async () => {
      const [reply] = await db
        .select({
          fromEmail: caseEmailReplies.fromEmail,
          fromName: caseEmailReplies.fromName,
          subject: caseEmailReplies.subject,
          bodyText: caseEmailReplies.bodyText,
          outreachId: caseEmailReplies.outreachId,
        })
        .from(caseEmailReplies)
        .where(eq(caseEmailReplies.id, replyId))
        .limit(1);
      if (!reply) return { reply: null, user: null, outreach: null };
      const [user] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const [outreach] = await db
        .select({ subject: caseEmailOutreach.subject })
        .from(caseEmailOutreach)
        .where(eq(caseEmailOutreach.id, reply.outreachId))
        .limit(1);
      return { reply, user, outreach };
    });

    if (!ctx.reply || !ctx.user?.email) return { skipped: "missing data" };

    await step.run("send", async () => {
      const preview = (ctx.reply!.bodyText ?? "").slice(0, 280);
      await sendEmail({
        to: ctx.user!.email,
        subject: `Client replied: ${ctx.outreach?.subject ?? ctx.reply!.subject}`,
        html: `<p><strong>${ctx.reply!.fromName ?? ctx.reply!.fromEmail}</strong> replied:</p><blockquote>${preview.replace(/</g, "&lt;")}</blockquote><p><a href="${process.env.APP_URL ?? ""}/cases">View in ClearTerms</a></p>`,
      });
    });

    return { ok: true };
  },
);
