// src/server/inngest/functions/intake-form-notifications.ts
//
// Consumes notification.intake_form_* events and dispatches per spec §5.4.
// Mirrors document-request-notifications.ts: portals go through
// `portal-notification/send`, lawyers go through `notification/send`.

import { inngest } from "@/server/inngest/client";
import type { NotificationSendEvent } from "@/lib/notification-types";

const LAWYER_TAB = (caseId: string) => `/cases/${caseId}?tab=intake`;
const PORTAL_INTAKE = (formId: string) => `/portal/intake/${formId}`;
const PORTAL_CASE = (caseId: string) => `/portal/cases/${caseId}`;

export const intakeFormSentNotify = inngest.createFunction(
  {
    id: "intake-form-sent-notify",
    retries: 1,
    triggers: [{ event: "notification.intake_form_sent" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      formId: string;
      formTitle: string;
      fieldCount: number;
      recipientPortalUserId: string;
    };
    const title = `New intake form: ${d.formTitle}`;
    const body = `Your lawyer has sent a form with ${d.fieldCount} question${d.fieldCount === 1 ? "" : "s"} for ${d.caseName}.`;
    const actionUrl = PORTAL_INTAKE(d.formId);
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "intake_form_sent",
        title,
        body,
        caseId: d.caseId,
        actionUrl,
        dedupKey: `intake_form_sent:${d.formId}:${d.recipientPortalUserId}`,
      },
    });
    return { delivered: "portal", portalUserId: d.recipientPortalUserId };
  },
);

export const intakeFormSubmittedNotify = inngest.createFunction(
  {
    id: "intake-form-submitted-notify",
    retries: 1,
    triggers: [{ event: "notification.intake_form_submitted" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      formId: string;
      formTitle: string;
      recipientUserId: string;
    };
    const title = `Client submitted: ${d.formTitle}`;
    const body = `The client has submitted the intake form for ${d.caseName}.`;
    const actionUrl = LAWYER_TAB(d.caseId);
    const payload: NotificationSendEvent = {
      userId: d.recipientUserId,
      type: "intake_form_submitted",
      title,
      body,
      caseId: d.caseId,
      actionUrl,
      metadata: {
        caseId: d.caseId,
        caseName: d.caseName,
        formId: d.formId,
        formTitle: d.formTitle,
        recipientUserId: d.recipientUserId,
      },
      dedupKey: `intake_form_submitted:${d.formId}:${d.recipientUserId}`,
    };
    await inngest.send({ name: "notification/send", data: payload });
    return { delivered: "lawyer", userId: d.recipientUserId };
  },
);

export const intakeFormCancelledNotify = inngest.createFunction(
  {
    id: "intake-form-cancelled-notify",
    retries: 1,
    triggers: [{ event: "notification.intake_form_cancelled" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      formId: string;
      formTitle: string;
      recipientPortalUserId: string;
    };
    const title = `Form cancelled: ${d.formTitle}`;
    const body = `The intake form for ${d.caseName} is no longer needed.`;
    const actionUrl = PORTAL_CASE(d.caseId);
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "intake_form_cancelled",
        title,
        body,
        caseId: d.caseId,
        actionUrl,
        dedupKey: `intake_form_cancelled:${d.formId}:${d.recipientPortalUserId}`,
      },
    });
    return { delivered: "portal", portalUserId: d.recipientPortalUserId };
  },
);
