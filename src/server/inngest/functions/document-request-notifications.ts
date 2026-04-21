// src/server/inngest/functions/document-request-notifications.ts
//
// Consumer handlers for the 5 `notification.document_request_*` events emitted
// by document-request-broadcast.ts. Each function computes title/body/actionUrl
// and forwards to `notification/send` (lawyer recipients) or
// `portal-notification/send` (portal recipients).

import { inngest } from "@/server/inngest/client";
import type { NotificationSendEvent } from "@/lib/notification-types";

const LAWYER_TAB = (caseId: string) => `/cases/${caseId}?tab=requests`;
const PORTAL_CASE = (caseId: string) => `/portal/cases/${caseId}`;

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) : s;
}

export const documentRequestCreatedNotify = inngest.createFunction(
  {
    id: "document-request-created-notify",
    retries: 1,
    triggers: [{ event: "notification.document_request_created" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      requestId: string;
      requestTitle: string;
      itemCount: number;
      recipientPortalUserId: string;
    };
    const title = `New document request: ${d.requestTitle}`;
    const body = `Your lawyer has requested ${d.itemCount} document${d.itemCount === 1 ? "" : "s"} for ${d.caseName}.`;
    const actionUrl = PORTAL_CASE(d.caseId);
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "document_request_created",
        title,
        body,
        caseId: d.caseId,
        actionUrl,
        dedupKey: `doc_req_created:${d.requestId}:${d.recipientPortalUserId}`,
      },
    });
    return { delivered: "portal", portalUserId: d.recipientPortalUserId };
  },
);

export const documentRequestItemUploadedNotify = inngest.createFunction(
  {
    id: "document-request-item-uploaded-notify",
    retries: 1,
    triggers: [{ event: "notification.document_request_item_uploaded" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      requestId: string;
      requestTitle: string;
      itemId: string;
      itemName: string;
      recipientUserId: string;
    };
    const title = "Client uploaded a document";
    const body = `${d.itemName} uploaded for "${d.requestTitle}" in ${d.caseName}.`;
    const actionUrl = LAWYER_TAB(d.caseId);
    const payload: NotificationSendEvent = {
      userId: d.recipientUserId,
      type: "document_request_item_uploaded",
      title,
      body,
      caseId: d.caseId,
      actionUrl,
      metadata: {
        caseId: d.caseId,
        caseName: d.caseName,
        requestId: d.requestId,
        requestTitle: d.requestTitle,
        itemId: d.itemId,
        itemName: d.itemName,
        recipientUserId: d.recipientUserId,
      },
      dedupKey: `doc_req_item_uploaded:${d.itemId}:${d.recipientUserId}`,
    };
    await inngest.send({ name: "notification/send", data: payload });
    return { delivered: "lawyer", userId: d.recipientUserId };
  },
);

export const documentRequestSubmittedNotify = inngest.createFunction(
  {
    id: "document-request-submitted-notify",
    retries: 1,
    triggers: [{ event: "notification.document_request_submitted" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      requestId: string;
      requestTitle: string;
      recipientUserId: string;
    };
    const title = "Document request ready for review";
    const body = `The client has finished uploading for "${d.requestTitle}" in ${d.caseName}.`;
    const actionUrl = LAWYER_TAB(d.caseId);
    const payload: NotificationSendEvent = {
      userId: d.recipientUserId,
      type: "document_request_submitted",
      title,
      body,
      caseId: d.caseId,
      actionUrl,
      metadata: {
        caseId: d.caseId,
        caseName: d.caseName,
        requestId: d.requestId,
        requestTitle: d.requestTitle,
        recipientUserId: d.recipientUserId,
      },
      dedupKey: `doc_req_submitted:${d.requestId}:${d.recipientUserId}`,
    };
    await inngest.send({ name: "notification/send", data: payload });
    return { delivered: "lawyer", userId: d.recipientUserId };
  },
);

export const documentRequestItemRejectedNotify = inngest.createFunction(
  {
    id: "document-request-item-rejected-notify",
    retries: 1,
    triggers: [{ event: "notification.document_request_item_rejected" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      requestId: string;
      requestTitle: string;
      itemId: string;
      itemName: string;
      rejectionNote: string;
      recipientPortalUserId: string;
    };
    const shortNote = truncate(d.rejectionNote ?? "", 200);
    const title = "A document needs revision";
    const body = `"${d.itemName}" was not accepted: ${shortNote}.`;
    const actionUrl = PORTAL_CASE(d.caseId);
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "document_request_item_rejected",
        title,
        body,
        caseId: d.caseId,
        actionUrl,
        dedupKey: `doc_req_item_rejected:${d.itemId}:${d.recipientPortalUserId}`,
      },
    });
    return { delivered: "portal", portalUserId: d.recipientPortalUserId };
  },
);

export const documentRequestCancelledNotify = inngest.createFunction(
  {
    id: "document-request-cancelled-notify",
    retries: 1,
    triggers: [{ event: "notification.document_request_cancelled" }],
  },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      requestId: string;
      requestTitle: string;
      recipientPortalUserId: string;
    };
    const title = "Document request cancelled";
    const body = `"${d.requestTitle}" for ${d.caseName} has been cancelled.`;
    const actionUrl = PORTAL_CASE(d.caseId);
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "document_request_cancelled",
        title,
        body,
        caseId: d.caseId,
        actionUrl,
        dedupKey: `doc_req_cancelled:${d.requestId}:${d.recipientPortalUserId}`,
      },
    });
    return { delivered: "portal", portalUserId: d.recipientPortalUserId };
  },
);
