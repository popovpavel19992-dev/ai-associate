// src/server/inngest/functions/deadline-reminders.ts
import { inngest } from "../client";
import { db } from "@/server/db";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { notifications } from "@/server/db/schema/notifications";
import { and, eq, isNull, lt, gte } from "drizzle-orm";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export const deadlineRemindersDaily = inngest.createFunction(
  {
    id: "deadline-reminders-daily",
    retries: 3,
    triggers: [{ cron: "0 12 * * *" }],
  },
  async ({ step }) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = isoDate(today);
    const in14Iso = isoDate(addDays(today, 14));

    const upcoming = await step.run("fetch-upcoming", async () => {
      return db
        .select({
          id: caseDeadlines.id,
          caseId: caseDeadlines.caseId,
          title: caseDeadlines.title,
          dueDate: caseDeadlines.dueDate,
          reminders: caseDeadlines.reminders,
        })
        .from(caseDeadlines)
        .where(
          and(
            isNull(caseDeadlines.completedAt),
            gte(caseDeadlines.dueDate, todayIso),
            lt(caseDeadlines.dueDate, in14Iso),
          ),
        );
    });

    const overdue = await step.run("fetch-overdue", async () => {
      return db
        .select({
          id: caseDeadlines.id,
          caseId: caseDeadlines.caseId,
          title: caseDeadlines.title,
          dueDate: caseDeadlines.dueDate,
        })
        .from(caseDeadlines)
        .where(
          and(
            isNull(caseDeadlines.completedAt),
            lt(caseDeadlines.dueDate, todayIso),
          ),
        );
    });

    const caseIds = Array.from(new Set([...upcoming, ...overdue].map((d) => d.caseId)));
    if (caseIds.length === 0) return { upcomingCount: 0, overdueCount: 0 };

    const caseOrgMap = await step.run("fetch-case-orgs", async () => {
      const rows = await db
        .select({ id: cases.id, orgId: cases.orgId })
        .from(cases);
      const map: Record<string, string | null> = {};
      for (const r of rows) map[r.id] = r.orgId ?? null;
      return map;
    });

    const orgToUsers = await step.run("fetch-org-members", async () => {
      const rows = await db.select({ id: users.id, orgId: users.orgId }).from(users);
      const m: Record<string, string[]> = {};
      for (const r of rows) {
        if (!r.orgId) continue;
        const arr = m[r.orgId] ?? [];
        arr.push(r.id);
        m[r.orgId] = arr;
      }
      return m;
    });

    let upcomingCount = 0;
    let overdueCount = 0;

    await step.run("insert-notifications", async () => {
      for (const d of upcoming) {
        const dueIso = d.dueDate as string;
        const due = new Date(dueIso + "T00:00:00.000Z");
        const daysBefore = Math.round((due.getTime() - today.getTime()) / 86400000);
        const configuredOffsets: number[] = Array.isArray(d.reminders)
          ? (d.reminders as number[])
          : [7, 3, 1];

        const orgId = caseOrgMap[d.caseId];
        if (!orgId) continue;
        const userIds = orgToUsers[orgId] ?? [];
        if (userIds.length === 0) continue;

        if (daysBefore === 0) {
          for (const uid of userIds) {
            try {
              await db.insert(notifications).values({
                userId: uid,
                type: "deadline_due_today",
                title: "Due today",
                body: `${d.title}`,
                caseId: d.caseId,
                dedupKey: `deadline:${d.id}:due_today`,
              });
              upcomingCount++;
            } catch {
              /* dedup hit */
            }
          }
        } else if (configuredOffsets.includes(daysBefore)) {
          for (const uid of userIds) {
            try {
              await db.insert(notifications).values({
                userId: uid,
                type: "deadline_upcoming",
                title: `Deadline in ${daysBefore} day${daysBefore === 1 ? "" : "s"}`,
                body: `${d.title}`,
                caseId: d.caseId,
                dedupKey: `deadline:${d.id}:upcoming:${daysBefore}`,
              });
              upcomingCount++;
            } catch {
              /* dedup hit */
            }
          }
        }
      }

      for (const d of overdue) {
        const orgId = caseOrgMap[d.caseId];
        if (!orgId) continue;
        const userIds = orgToUsers[orgId] ?? [];
        for (const uid of userIds) {
          try {
            await db.insert(notifications).values({
              userId: uid,
              type: "deadline_overdue",
              title: `OVERDUE: ${d.title}`,
              body: `Was due ${d.dueDate}`,
              caseId: d.caseId,
              dedupKey: `deadline:${d.id}:overdue:${todayIso}`,
            });
            overdueCount++;
          } catch {
            /* dedup hit */
          }
        }
      }
    });

    return { upcomingCount, overdueCount, cases: caseIds.length };
  },
);
