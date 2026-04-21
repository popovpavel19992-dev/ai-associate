// src/server/inngest/functions/milestone-notifications.ts
import { inngest } from "@/server/inngest/client";

export const milestonePublishedNotify = inngest.createFunction(
  { id: "milestone-published-notify", retries: 1, triggers: [{ event: "notification.milestone_published" }] },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      milestoneId: string;
      title: string;
      category: string;
      occurredAt: string;
      recipientPortalUserId: string;
    };
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "milestone_published",
        title: `Case update: ${d.title}`,
        body: `Your lawyer posted a new update on ${d.caseName}.`,
        caseId: d.caseId,
        actionUrl: `/portal/cases/${d.caseId}`,
        metadata: d,
      },
    });
    return { dispatched: true };
  },
);

export const milestoneRetractedNotify = inngest.createFunction(
  { id: "milestone-retracted-notify", retries: 1, triggers: [{ event: "notification.milestone_retracted" }] },
  async ({ event }) => {
    const d = event.data as {
      caseId: string;
      caseName: string;
      milestoneId: string;
      title: string;
      recipientPortalUserId: string;
    };
    await inngest.send({
      name: "portal-notification/send",
      data: {
        portalUserId: d.recipientPortalUserId,
        type: "milestone_retracted",
        title: `Update retracted: ${d.title}`,
        body: `A previous case update was retracted.`,
        caseId: d.caseId,
        actionUrl: `/portal/cases/${d.caseId}`,
        metadata: d,
      },
    });
    return { dispatched: true };
  },
);
