// src/server/inngest/functions/public-intake-notifications.ts
//
// Phase 3.11 — fan out a "new public intake submission" event to every
// owner/admin in the receiving org via the standard `notification/send` path.

import { inngest } from "@/server/inngest/client";
import { PublicIntakeSubmissionsService } from "@/server/services/public-intake/submissions-service";
import type { NotificationSendEvent } from "@/lib/notification-types";

export const publicIntakeSubmissionCreated = inngest.createFunction(
  {
    id: "public-intake-submission-created",
    retries: 1,
    triggers: [{ event: "public-intake/submission.created" }],
  },
  async ({ event, step }) => {
    const data = event.data as {
      submissionId: string;
      orgId: string;
      templateId: string;
      templateName: string;
      submitterName: string | null;
    };

    const recipients = await step.run("load-admin-recipients", async () => {
      const svc = new PublicIntakeSubmissionsService();
      return svc.getOrgAdminUserIds(data.orgId);
    });

    if (recipients.length === 0) {
      return { delivered: 0, reason: "no_admins" };
    }

    const submitter = data.submitterName?.trim() || "Someone";
    const title = `New intake: ${submitter} via ${data.templateName}`;
    const body = `New public intake submission for "${data.templateName}".`;
    const actionUrl = `/intake-inbox/${data.submissionId}`;

    await step.run("dispatch-notifications", async () => {
      await Promise.all(
        recipients.map((userId) => {
          const payload: NotificationSendEvent = {
            userId,
            orgId: data.orgId,
            type: "public_intake_submission_new",
            title,
            body,
            actionUrl,
            metadata: {
              submissionId: data.submissionId,
              templateId: data.templateId,
              templateName: data.templateName,
              submitterName: data.submitterName,
            },
            dedupKey: `public_intake_submission_new:${data.submissionId}:${userId}`,
          };
          return inngest.send({ name: "notification/send", data: payload });
        }),
      );
    });

    return { delivered: recipients.length };
  },
);
