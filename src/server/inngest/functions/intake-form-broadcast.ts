// src/server/inngest/functions/intake-form-broadcast.ts
//
// Fans out 3 notification events from canonical messaging/intake_form.* events.
// Mirror of document-request-broadcast.ts (Inngest v4 two-arg createFunction).

import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { intakeForms } from "@/server/db/schema/intake-forms";
import { cases } from "@/server/db/schema/cases";
import { portalRecipients, lawyerRecipients } from "@/server/services/messaging/recipients";

async function loadContext(formId: string) {
  const [form] = await defaultDb
    .select({ id: intakeForms.id, caseId: intakeForms.caseId, title: intakeForms.title, schema: intakeForms.schema })
    .from(intakeForms)
    .where(eq(intakeForms.id, formId))
    .limit(1);
  if (!form) return null;
  const [caseRow] = await defaultDb
    .select({ id: cases.id, name: cases.name, clientId: cases.clientId, orgId: cases.orgId, ownerId: cases.userId })
    .from(cases)
    .where(eq(cases.id, form.caseId))
    .limit(1);
  if (!caseRow) return null;
  const fieldCount = Array.isArray((form.schema as { fields?: unknown[] } | null)?.fields)
    ? ((form.schema as { fields: unknown[] }).fields.length)
    : 0;
  return { form, caseRow, fieldCount };
}

export const intakeFormSentBroadcast = inngest.createFunction(
  { id: "intake-form-sent-broadcast", retries: 1, triggers: [{ event: "messaging/intake_form.sent" }] },
  async ({ event }) => {
    const { formId } = event.data as { formId: string };
    const ctx = await loadContext(formId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.caseRow.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.intake_form_sent",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          formId,
          formTitle: ctx.form.title,
          fieldCount: ctx.fieldCount,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);

export const intakeFormSubmittedBroadcast = inngest.createFunction(
  { id: "intake-form-submitted-broadcast", retries: 1, triggers: [{ event: "messaging/intake_form.submitted" }] },
  async ({ event }) => {
    const { formId } = event.data as { formId: string };
    const ctx = await loadContext(formId);
    if (!ctx) return { skipped: true };
    const lawyers = await lawyerRecipients(ctx.caseRow.id, ctx.caseRow.ownerId);
    for (const userId of lawyers) {
      await inngest.send({
        name: "notification.intake_form_submitted",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          formId,
          formTitle: ctx.form.title,
          recipientUserId: userId,
        },
      });
    }
    return { lawyers: lawyers.length };
  },
);

export const intakeFormCancelledBroadcast = inngest.createFunction(
  { id: "intake-form-cancelled-broadcast", retries: 1, triggers: [{ event: "messaging/intake_form.cancelled" }] },
  async ({ event }) => {
    const { formId } = event.data as { formId: string };
    const ctx = await loadContext(formId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.caseRow.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.intake_form_cancelled",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          formId,
          formTitle: ctx.form.title,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);
