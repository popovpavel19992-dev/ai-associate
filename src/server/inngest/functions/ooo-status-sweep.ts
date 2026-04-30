// src/server/inngest/functions/ooo-status-sweep.ts
//
// Phase 3.14 — Hourly cron that transitions OOO periods:
//   * scheduled → active when start_date <= today
//   * active    → ended  when end_date  <  today

import { inngest } from "../client";
import { db } from "@/server/db";
import { transitionStatus } from "@/server/services/out-of-office/service";

export const oooStatusSweep = inngest.createFunction(
  {
    id: "ooo-status-sweep",
    retries: 2,
    triggers: [{ cron: "0 * * * *" }], // hourly
  },
  async ({ step }) => {
    const result = await step.run("transition", async () => {
      return transitionStatus(db);
    });
    return { sweptAt: new Date().toISOString(), ...result };
  },
);
