// src/server/inngest/functions/milestone-broadcast.ts
import { inngest } from "@/server/inngest/client";
import { db as defaultDb } from "@/server/db";
import { eq } from "drizzle-orm";
import { caseMilestones } from "@/server/db/schema/case-milestones";
import { cases } from "@/server/db/schema/cases";
import { portalRecipients } from "@/server/services/messaging/recipients";

async function loadContext(milestoneId: string) {
  const [m] = await defaultDb
    .select({
      id: caseMilestones.id,
      caseId: caseMilestones.caseId,
      title: caseMilestones.title,
      category: caseMilestones.category,
      occurredAt: caseMilestones.occurredAt,
    })
    .from(caseMilestones)
    .where(eq(caseMilestones.id, milestoneId))
    .limit(1);
  if (!m) return null;
  const [c] = await defaultDb
    .select({ id: cases.id, name: cases.name, clientId: cases.clientId })
    .from(cases)
    .where(eq(cases.id, m.caseId))
    .limit(1);
  if (!c) return null;
  return { m, c };
}

export const milestonePublishedBroadcast = inngest.createFunction(
  { id: "milestone-published-broadcast", retries: 1, triggers: [{ event: "messaging/milestone.published" }] },
  async ({ event }) => {
    const { milestoneId } = event.data as { milestoneId: string };
    const ctx = await loadContext(milestoneId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.c.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.milestone_published",
        data: {
          caseId: ctx.c.id,
          caseName: ctx.c.name ?? "Case",
          milestoneId,
          title: ctx.m.title,
          category: ctx.m.category,
          occurredAt: ctx.m.occurredAt.toISOString(),
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);

export const milestoneRetractedBroadcast = inngest.createFunction(
  { id: "milestone-retracted-broadcast", retries: 1, triggers: [{ event: "messaging/milestone.retracted" }] },
  async ({ event }) => {
    const { milestoneId } = event.data as { milestoneId: string };
    const ctx = await loadContext(milestoneId);
    if (!ctx) return { skipped: true };
    const portals = await portalRecipients(ctx.c.clientId);
    for (const portalUserId of portals) {
      await inngest.send({
        name: "notification.milestone_retracted",
        data: {
          caseId: ctx.c.id,
          caseName: ctx.c.name ?? "Case",
          milestoneId,
          title: ctx.m.title,
          recipientPortalUserId: portalUserId,
        },
      });
    }
    return { portals: portals.length };
  },
);
