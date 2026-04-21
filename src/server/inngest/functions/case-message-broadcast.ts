// src/server/inngest/functions/case-message-broadcast.ts
//
// Listens for messaging/case_message.created and:
// 1. Fans out notification.case_message_received per recipient (lawyer + portal).
// 2. Emits to in-process pubsub for SSE subscribers.

import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { caseMessages } from "@/server/db/schema/case-messages";
import { caseMembers } from "@/server/db/schema/case-members";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { portalUsers } from "@/server/db/schema/portal-users";
import { messagingPubsub } from "@/server/services/messaging/pubsub";

export const caseMessageBroadcast = inngest.createFunction(
  {
    id: "case-message-broadcast",
    retries: 1,
    triggers: [{ event: "messaging/case_message.created" }],
  },
  async ({ event }) => {
    const { messageId, caseId, authorType, authorUserId } = event.data as {
      messageId: string;
      caseId: string;
      authorType: "lawyer" | "client";
      authorUserId: string;
    };

    const [msg] = await defaultDb
      .select()
      .from(caseMessages)
      .where(eq(caseMessages.id, messageId))
      .limit(1);
    if (!msg) return { error: "Message vanished" };

    const [caseRow] = await defaultDb
      .select({ id: cases.id, name: cases.name, clientId: cases.clientId, orgId: cases.orgId, ownerId: cases.userId })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    if (!caseRow) return { error: "Case missing" };

    // Resolve author display name
    let authorName = "Someone";
    if (authorType === "lawyer") {
      const [u] = await defaultDb
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, authorUserId))
        .limit(1);
      authorName = u?.name ?? "Lawyer";
    } else {
      const [pu] = await defaultDb
        .select({ displayName: portalUsers.displayName })
        .from(portalUsers)
        .where(eq(portalUsers.id, authorUserId))
        .limit(1);
      authorName = pu?.displayName ?? "Client";
    }

    const bodyPreview = msg.body.slice(0, 120);

    // Lawyer recipients = case_members + ownerId, excluding the sender if lawyer.
    const memberRows = await defaultDb
      .select({ userId: caseMembers.userId })
      .from(caseMembers)
      .where(eq(caseMembers.caseId, caseId));
    const lawyerIds = new Set<string>(memberRows.map((r) => r.userId));
    if (caseRow.ownerId) lawyerIds.add(caseRow.ownerId);
    if (authorType === "lawyer") lawyerIds.delete(authorUserId);

    for (const lawyerId of lawyerIds) {
      await inngest.send({
        name: "notification.case_message_received",
        data: {
          caseId,
          caseName: caseRow.name ?? "Case",
          messageId,
          authorName,
          bodyPreview,
          recipientUserId: lawyerId,
          recipientType: "lawyer",
        },
      });
    }

    // Portal recipients = portal_users on the same client (excluding sender if portal).
    if (caseRow.clientId) {
      const portalRows = await defaultDb
        .select({ id: portalUsers.id })
        .from(portalUsers)
        .where(eq(portalUsers.clientId, caseRow.clientId));
      for (const p of portalRows) {
        if (authorType === "client" && p.id === authorUserId) continue;
        await inngest.send({
          name: "notification.case_message_received",
          data: {
            caseId,
            caseName: caseRow.name ?? "Case",
            messageId,
            authorName,
            bodyPreview,
            recipientUserId: "", // unused for portal recipient
            recipientPortalUserId: p.id,
            recipientType: "portal",
          },
        });
      }
    }

    // SSE broadcast to anyone with an open subscription on this case.
    messagingPubsub.emit(`case:${caseId}`, {
      id: msg.id,
      caseId,
      authorType,
      body: msg.body,
      createdAt: msg.createdAt,
      documentId: msg.documentId,
    });

    return { dispatched: lawyerIds.size, broadcast: true };
  },
);
