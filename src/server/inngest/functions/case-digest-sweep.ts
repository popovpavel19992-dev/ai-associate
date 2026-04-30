// src/server/inngest/functions/case-digest-sweep.ts
//
// Phase 3.18 — Hourly cron: dispatch digests to users whose
// delivery_time_utc matches the current UTC hour AND who haven't
// been sent today (or this week, for weekly).

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { digestPreferences } from "../../db/schema/digest-preferences";
import { sendDigestForUser } from "../../services/case-digest/send-service";

export const caseDigestSweep = inngest.createFunction(
  {
    id: "case-digest-sweep",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const currentHour = `${hh}:00`;

    // Day window: today UTC start.
    const todayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0, 0, 0, 0,
    ));
    // Weekly window: 6 days ago.
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

    const candidates = await db
      .select({
        userId: digestPreferences.userId,
        frequency: digestPreferences.frequency,
        lastSentAt: digestPreferences.lastSentAt,
      })
      .from(digestPreferences)
      .where(
        and(
          eq(digestPreferences.enabled, true),
          eq(digestPreferences.deliveryTimeUtc, currentHour),
          or(
            eq(digestPreferences.frequency, "daily"),
            eq(digestPreferences.frequency, "weekly"),
          ),
        ),
      );

    const due = candidates.filter((c) => {
      if (c.frequency === "daily") {
        return !c.lastSentAt || c.lastSentAt < todayStart;
      }
      if (c.frequency === "weekly") {
        return !c.lastSentAt || c.lastSentAt < sixDaysAgo;
      }
      return false;
    });

    const results: Array<{ userId: string; sent: boolean; reason?: string }> = [];

    for (const c of due) {
      const r = await step.run(`send-digest-${c.userId}`, async () => {
        try {
          const out = await sendDigestForUser(db, c.userId, { asOf: now });
          return { userId: c.userId, sent: out.sent, reason: out.reason };
        } catch (err) {
          console.error(`[case-digest-sweep] send failed for ${c.userId}`, err);
          return { userId: c.userId, sent: false, reason: "error" };
        }
      });
      results.push(r);
    }

    return { hour: currentHour, candidateCount: candidates.length, dueCount: due.length, results };
  },
);
