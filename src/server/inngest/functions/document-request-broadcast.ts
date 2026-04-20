// src/server/inngest/functions/document-request-broadcast.ts
//
// Fans out 5 notification events from canonical messaging/document_request.* events.
// Pattern mirrors case-message-broadcast.ts (Inngest v4 two-arg createFunction).

import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { documentRequests } from "@/server/db/schema/document-requests";
import { documentRequestItems } from "@/server/db/schema/document-request-items";
import { cases } from "@/server/db/schema/cases";
import { caseMembers } from "@/server/db/schema/case-members";
import { portalUsers } from "@/server/db/schema/portal-users";

async function loadContext(requestId: string) {
  const [req] = await defaultDb
    .select({ id: documentRequests.id, caseId: documentRequests.caseId, title: documentRequests.title })
    .from(documentRequests)
    .where(eq(documentRequests.id, requestId))
    .limit(1);
  if (!req) return null;
  const [caseRow] = await defaultDb
    .select({ id: cases.id, name: cases.name, clientId: cases.clientId, orgId: cases.orgId, ownerId: cases.userId })
    .from(cases)
    .where(eq(cases.id, req.caseId))
    .limit(1);
  if (!caseRow) return null;
  return { req, caseRow };
}

async function portalRecipients(clientId: string | null): Promise<string[]> {
  if (!clientId) return [];
  const rows = await defaultDb
    .select({ id: portalUsers.id })
    .from(portalUsers)
    .where(eq(portalUsers.clientId, clientId));
  return rows.map((r) => r.id);
}

async function lawyerRecipients(caseId: string, ownerId: string | null): Promise<string[]> {
  const members = await defaultDb
    .select({ userId: caseMembers.userId })
    .from(caseMembers)
    .where(eq(caseMembers.caseId, caseId));
  const set = new Set<string>(members.map((m) => m.userId));
  if (ownerId) set.add(ownerId);
  return [...set];
}

export const documentRequestCreatedBroadcast = inngest.createFunction(
  { id: "document-request-created-broadcast", retries: 1, triggers: [{ event: "messaging/document_request.created" }] },
  async ({ event }) => {
    const { requestId } = event.data as { requestId: string };
    const ctx = await loadContext(requestId);
    if (!ctx) return { skipped: true };
    const itemRows = await defaultDb
      .select({ id: documentRequestItems.id })
      .from(documentRequestItems)
      .where(eq(documentRequestItems.requestId, requestId));
    const portals = await portalRecipients(ctx.caseRow.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.document_request_created",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          requestId,
          requestTitle: ctx.req.title,
          itemCount: itemRows.length,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);

export const documentRequestItemUploadedBroadcast = inngest.createFunction(
  { id: "document-request-item-uploaded-broadcast", retries: 1, triggers: [{ event: "messaging/document_request.item_uploaded" }] },
  async ({ event }) => {
    const { requestId, itemId, itemName } = event.data as { requestId: string; itemId: string; itemName: string };
    const ctx = await loadContext(requestId);
    if (!ctx) return { skipped: true };
    const lawyers = await lawyerRecipients(ctx.caseRow.id, ctx.caseRow.ownerId);
    for (const userId of lawyers) {
      await inngest.send({
        name: "notification.document_request_item_uploaded",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          requestId, requestTitle: ctx.req.title, itemId, itemName,
          recipientUserId: userId,
        },
      });
    }
    return { lawyers: lawyers.length };
  },
);

export const documentRequestSubmittedBroadcast = inngest.createFunction(
  { id: "document-request-submitted-broadcast", retries: 1, triggers: [{ event: "messaging/document_request.submitted" }] },
  async ({ event }) => {
    const { requestId } = event.data as { requestId: string };
    const ctx = await loadContext(requestId);
    if (!ctx) return { skipped: true };
    const lawyers = await lawyerRecipients(ctx.caseRow.id, ctx.caseRow.ownerId);
    for (const userId of lawyers) {
      await inngest.send({
        name: "notification.document_request_submitted",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          requestId, requestTitle: ctx.req.title,
          recipientUserId: userId,
        },
      });
    }
    return { lawyers: lawyers.length };
  },
);

export const documentRequestItemRejectedBroadcast = inngest.createFunction(
  { id: "document-request-item-rejected-broadcast", retries: 1, triggers: [{ event: "messaging/document_request.item_rejected" }] },
  async ({ event }) => {
    const { requestId, itemId, itemName, rejectionNote } = event.data as {
      requestId: string; itemId: string; itemName: string; rejectionNote: string;
    };
    const ctx = await loadContext(requestId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.caseRow.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.document_request_item_rejected",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          requestId, requestTitle: ctx.req.title, itemId, itemName, rejectionNote,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);

export const documentRequestCancelledBroadcast = inngest.createFunction(
  { id: "document-request-cancelled-broadcast", retries: 1, triggers: [{ event: "messaging/document_request.cancelled" }] },
  async ({ event }) => {
    const { requestId } = event.data as { requestId: string };
    const ctx = await loadContext(requestId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.caseRow.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.document_request_cancelled",
        data: {
          caseId: ctx.caseRow.id,
          caseName: ctx.caseRow.name ?? "Case",
          requestId, requestTitle: ctx.req.title,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);
