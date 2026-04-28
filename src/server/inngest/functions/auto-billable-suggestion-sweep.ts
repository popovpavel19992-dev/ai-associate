// src/server/inngest/functions/auto-billable-suggestion-sweep.ts
//
// Phase 3.9 — nightly cron that sessionizes recent activity for every
// active user and inserts pending suggested_time_entries rows.

import { inngest } from "../client";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { isNotNull } from "drizzle-orm";
import { refreshSuggestions } from "@/server/services/activity-tracking/suggestions-service";

export const autoBillableSuggestionSweep = inngest.createFunction(
  {
    id: "auto-billable-suggestion-sweep",
    retries: 2,
    triggers: [{ cron: "30 23 * * *" }], // 23:30 UTC daily
  },
  async ({ step }) => {
    const activeUsers = await step.run("fetch-users", async () => {
      return db
        .select({ id: users.id })
        .from(users)
        .where(isNotNull(users.orgId));
    });

    let totalCreated = 0;
    let processed = 0;

    for (const u of activeUsers) {
      // Each user gets its own step so a single failure doesn't poison the batch.
      const created = await step.run(`refresh-${u.id}`, async () => {
        try {
          const r = await refreshSuggestions(db, u.id, 7);
          return r.created;
        } catch {
          return 0;
        }
      });
      totalCreated += created;
      processed++;
    }

    return { processed, totalCreated };
  },
);
