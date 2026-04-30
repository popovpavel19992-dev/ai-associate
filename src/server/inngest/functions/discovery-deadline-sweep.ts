// src/server/inngest/functions/discovery-deadline-sweep.ts
//
// Daily cron — flips served Discovery requests with elapsed 30-day deadlines
// to status='overdue' and pings the lead lawyer (request.createdBy). For RFAs
// the notification copy includes an FRCP 36(a)(3) "deemed admitted" alert.

import { inngest } from "../client";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema/notifications";
import {
  findOverdueRequests,
  markRequestOverdue,
} from "@/server/services/discovery-responses/deadline-checker";

export const discoveryDeadlineSweep = inngest.createFunction(
  {
    id: "discovery-deadline-sweep",
    retries: 3,
    triggers: [{ cron: "0 9 * * *" }],
  },
  async ({ step }) => {
    const now = new Date();

    const overdue = await step.run("find-overdue", async () => {
      return findOverdueRequests(db, now);
    });

    if (overdue.length === 0) {
      return { overdueCount: 0 };
    }

    let flagged = 0;
    let notified = 0;

    await step.run("mark-and-notify", async () => {
      for (const r of overdue) {
        await markRequestOverdue(db, r.id);
        flagged += 1;

        const isRfa = r.requestType === "rfa";
        const title = isRfa
          ? `ALERT: RFAs may be deemed admitted — ${r.title}`
          : `OVERDUE: Discovery responses past due — ${r.title}`;
        const body = isRfa
          ? `Set ${r.setNumber} of ${r.title} was served on ${new Date(r.servedAt as unknown as string | Date).toISOString().slice(0, 10)} and the 30-day response window has elapsed without responses. Under FRCP 36(a)(3), unanswered Requests for Admission may be deemed admitted. Review immediately.`
          : `Set ${r.setNumber} of ${r.title} was served on ${new Date(r.servedAt as unknown as string | Date).toISOString().slice(0, 10)} and the 30-day response window has elapsed without responses.`;

        try {
          await db.insert(notifications).values({
            userId: r.createdBy,
            type: "discovery_overdue",
            title,
            body,
            caseId: r.caseId,
            dedupKey: `discovery_overdue:${r.id}`,
          });
          notified += 1;
        } catch {
          // dedup hit — already notified for this request
        }
      }
    });

    return { overdueCount: overdue.length, flagged, notified };
  },
);
