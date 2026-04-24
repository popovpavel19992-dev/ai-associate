// src/server/inngest/functions/drip-sequence-sweeper.ts
import { and, eq, lte, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/server/db";
import { emailDripEnrollments } from "@/server/db/schema/email-drip-enrollments";
import { emailDripSequenceSteps } from "@/server/db/schema/email-drip-sequence-steps";
import { emailTemplates } from "@/server/db/schema/email-templates";
import { EmailOutreachService } from "@/server/services/email-outreach/service";
import { sendEmail } from "@/server/services/email";
import { getObject } from "@/server/services/s3";

const SWEEP_BATCH_SIZE = 100;

async function fetchS3ToBuffer(s3Key: string): Promise<Buffer> {
  const { body } = await getObject(s3Key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((u) => Buffer.from(u)));
}

async function resendSendAdapter(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: any[];
  replyTo?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
  threadHeaders?: { inReplyTo: string; references: string[] };
}): Promise<{ id?: string }> {
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
    replyTo: opts.replyTo,
    trackOpens: opts.trackOpens,
    trackClicks: opts.trackClicks,
    threadHeaders: opts.threadHeaders,
  });
  return { id: undefined };
}

export const dripSequenceSweeper = inngest.createFunction(
  {
    id: "drip-sequence-sweeper",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const now = new Date();

    const due = await step.run("find-due", async () => {
      return db
        .select({
          id: emailDripEnrollments.id,
          sequenceId: emailDripEnrollments.sequenceId,
          clientContactId: emailDripEnrollments.clientContactId,
          caseId: emailDripEnrollments.caseId,
          orgId: emailDripEnrollments.orgId,
          currentStepOrder: emailDripEnrollments.currentStepOrder,
          enrolledBy: emailDripEnrollments.enrolledBy,
        })
        .from(emailDripEnrollments)
        .where(
          and(
            eq(emailDripEnrollments.status, "active"),
            lte(emailDripEnrollments.nextSendAt, now),
          ),
        )
        .limit(SWEEP_BATCH_SIZE);
    });

    if (due.length === 0) {
      return { checkedAt: now.toISOString(), processed: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const enrollment of due) {
      const result = await step.run(`send-${enrollment.id}`, async () => {
        try {
          if (!enrollment.caseId) {
            console.warn(
              `[drip-sweeper] enrollment ${enrollment.id} missing caseId; cannot send via email-outreach service`,
            );
            return { ok: false as const, reason: "missing_case_id" };
          }

          // 1. Load current step + template.
          const [step] = await db
            .select({
              id: emailDripSequenceSteps.id,
              stepOrder: emailDripSequenceSteps.stepOrder,
              templateId: emailDripSequenceSteps.templateId,
              templateSubject: emailTemplates.subject,
              templateBodyMarkdown: emailTemplates.bodyMarkdown,
            })
            .from(emailDripSequenceSteps)
            .innerJoin(emailTemplates, eq(emailTemplates.id, emailDripSequenceSteps.templateId))
            .where(
              and(
                eq(emailDripSequenceSteps.sequenceId, enrollment.sequenceId),
                eq(emailDripSequenceSteps.stepOrder, enrollment.currentStepOrder),
              ),
            )
            .limit(1);

          if (!step) {
            console.warn(
              `[drip-sweeper] no step found for enrollment ${enrollment.id} at order ${enrollment.currentStepOrder}`,
            );
            return { ok: false as const, reason: "step_not_found" };
          }

          // 2. Send via existing email-outreach service.
          const svc = new EmailOutreachService({
            db,
            resendSend: resendSendAdapter,
            fetchObject: fetchS3ToBuffer,
          });

          await svc.send({
            caseId: enrollment.caseId,
            templateId: step.templateId,
            subject: step.templateSubject,
            bodyMarkdown: step.templateBodyMarkdown,
            documentIds: [],
            senderId: enrollment.enrolledBy,
            trackingEnabled: false,
            parentReplyId: null,
          });

          // 3. Advance enrollment: find next step, set nextSendAt = now + delayDays,
          //    or mark completed if no further step exists.
          const [nextStep] = await db
            .select({
              stepOrder: emailDripSequenceSteps.stepOrder,
              delayDays: emailDripSequenceSteps.delayDays,
            })
            .from(emailDripSequenceSteps)
            .where(
              and(
                eq(emailDripSequenceSteps.sequenceId, enrollment.sequenceId),
                sql`${emailDripSequenceSteps.stepOrder} > ${enrollment.currentStepOrder}`,
              ),
            )
            .orderBy(emailDripSequenceSteps.stepOrder)
            .limit(1);

          const sentAt = new Date();
          if (nextStep) {
            const next = new Date(sentAt.getTime() + nextStep.delayDays * 24 * 60 * 60 * 1000);
            await db
              .update(emailDripEnrollments)
              .set({
                currentStepOrder: nextStep.stepOrder,
                nextSendAt: next,
                lastStepSentAt: sentAt,
              })
              .where(eq(emailDripEnrollments.id, enrollment.id));
          } else {
            await db
              .update(emailDripEnrollments)
              .set({
                status: "completed",
                nextSendAt: null,
                lastStepSentAt: sentAt,
                completedAt: sentAt,
              })
              .where(eq(emailDripEnrollments.id, enrollment.id));
          }

          return { ok: true as const };
        } catch (err) {
          // Per spec: do NOT advance on failure; leave nextSendAt unchanged so
          // the sweeper retries next cycle. No last_send_error column in MVP —
          // log to console.
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[drip-sweeper] send failed for enrollment ${enrollment.id} (seq=${enrollment.sequenceId} step=${enrollment.currentStepOrder}): ${msg}`,
          );
          return { ok: false as const, reason: msg.slice(0, 500) };
        }
      });

      if (result.ok) sent++;
      else failed++;
    }

    return {
      checkedAt: now.toISOString(),
      processed: due.length,
      sent,
      failed,
    };
  },
);
