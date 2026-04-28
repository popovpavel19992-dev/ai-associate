// src/server/services/activity-tracking/service.ts
//
// Phase 3.9 — write-side service for the case_activity_events stream.
// Used by tRPC mutations and by mutation-instrumentation hooks inside
// other routers.

import { eq } from "drizzle-orm";
import {
  caseActivityEvents,
  type ActivityEventType,
} from "@/server/db/schema/case-activity-events";

type Db = typeof import("@/server/db").db;

export interface LogActivityInput {
  orgId: string;
  userId: string;
  caseId: string;
  eventType: ActivityEventType;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
  contextUrl?: string | null;
}

/** Insert a single activity event row. duration_seconds defaults to 0 — page-view
 *  rows are backfilled by closeOutPageView when the user navigates away. */
export async function logActivity(
  db: Db,
  input: LogActivityInput,
): Promise<{ id: string }> {
  const duration = Math.min(Math.max(input.durationSeconds ?? 0, 0), 14400);

  const [row] = await db
    .insert(caseActivityEvents)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      caseId: input.caseId,
      eventType: input.eventType,
      durationSeconds: duration,
      metadata: input.metadata ?? {},
      contextUrl: input.contextUrl ?? null,
    })
    .returning({ id: caseActivityEvents.id });

  return { id: row!.id };
}

export interface CloseOutPageViewInput {
  userId: string;
  eventId: string;
  durationSeconds: number;
}

/** Update an existing event row with the final observed duration. */
export async function closeOutPageView(
  db: Db,
  input: CloseOutPageViewInput,
): Promise<void> {
  const duration = Math.min(Math.max(input.durationSeconds, 0), 14400);

  await db
    .update(caseActivityEvents)
    .set({ durationSeconds: duration })
    .where(eq(caseActivityEvents.id, input.eventId));
}
