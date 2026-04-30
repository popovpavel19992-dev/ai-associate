// src/server/services/case-digest/send-service.ts
//
// Phase 3.18 — Per-user digest send pipeline. Skips silently when:
//   1. preferences row is missing AND we won't auto-create (manual sendNow does)
//   2. preferences disabled or frequency='off'
//   3. user is OOO today
//   4. zero action items in payload
// Otherwise: aggregates, generates AI commentary, composes email, sends, logs.

import { eq } from "drizzle-orm";
import type { db as defaultDb } from "@/server/db";
import { digestPreferences } from "@/server/db/schema/digest-preferences";
import { digestLogs } from "@/server/db/schema/digest-logs";
import { aggregateForUser } from "./aggregator";
import { generateCommentary } from "./ai-commentary";
import { composeDigestEmail } from "./compose";
import { sendEmail } from "@/server/services/email";

type Db = typeof defaultDb;

export interface SendDigestResult {
  sent: boolean;
  reason?: "disabled" | "off" | "ooo" | "no_items" | "no_prefs";
  logId?: string;
}

export async function sendDigestForUser(
  db: Db,
  userId: string,
  opts: { force?: boolean; asOf?: Date } = {},
): Promise<SendDigestResult> {
  const asOf = opts.asOf ?? new Date();

  // 1. Load preferences.
  const [prefs] = await db
    .select()
    .from(digestPreferences)
    .where(eq(digestPreferences.userId, userId))
    .limit(1);

  if (!opts.force) {
    if (!prefs) return { sent: false, reason: "no_prefs" };
    if (!prefs.enabled) return { sent: false, reason: "disabled" };
    if (prefs.frequency === "off") return { sent: false, reason: "off" };
  }

  // 2. Aggregate first so we can short-circuit on OOO + zero items.
  const payload = await aggregateForUser(db, userId, asOf);

  if (!opts.force && payload.isOoo) {
    return { sent: false, reason: "ooo" };
  }

  if (payload.totalActionItems === 0 && !opts.force) {
    return { sent: false, reason: "no_items" };
  }

  // 3. AI commentary.
  const commentary = await generateCommentary(payload);

  // 4. Compose.
  const { subject, html, text } = composeDigestEmail(payload, commentary);

  // 5. Send.
  await sendEmail({ to: payload.user.email, subject, html });

  // 6. Log.
  const [log] = await db
    .insert(digestLogs)
    .values({
      userId,
      subject,
      preview: text.slice(0, 280),
      itemCount: payload.totalActionItems,
      aiSummary: commentary,
      payload: payload as unknown as Record<string, unknown>,
    })
    .returning({ id: digestLogs.id });

  // 7. Update last_sent_at (upsert).
  await db
    .insert(digestPreferences)
    .values({ userId, lastSentAt: new Date() })
    .onConflictDoUpdate({
      target: digestPreferences.userId,
      set: { lastSentAt: new Date(), updatedAt: new Date() },
    });

  return { sent: true, logId: log.id };
}
