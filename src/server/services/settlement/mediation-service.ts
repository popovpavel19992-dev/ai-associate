// src/server/services/settlement/mediation-service.ts
//
// Mediation session service for ClearTerms 3.4.
// Lifecycle:
//   scheduled → completed | cancelled | rescheduled
// Outcome ('pending' | 'settled' | 'impasse' | 'continued') is set independently.
// Once status is 'completed' or 'cancelled', only notes/outcome are editable.
// Delete only allowed while status is 'scheduled' or 'cancelled'.

import { desc, eq, max } from "drizzle-orm";
import {
  caseMediationSessions,
  type MediationSessionType,
  type MediationStatus,
  type MediationOutcome,
} from "@/server/db/schema/case-mediation-sessions";

type Db = any;

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseMediationSessions.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(caseMediationSessions)
    .where(eq(caseMediationSessions.caseId, caseId))
    .orderBy(desc(caseMediationSessions.sessionNumber));
  return rows as (typeof caseMediationSessions.$inferSelect)[];
}

export async function getSession(
  db: Db,
  sessionId: string,
): Promise<typeof caseMediationSessions.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseMediationSessions)
    .where(eq(caseMediationSessions.id, sessionId))
    .limit(1);
  if (!row) throw new Error("Mediation session not found");
  return row as typeof caseMediationSessions.$inferSelect;
}

export async function getNextSessionNumber(
  db: Db,
  caseId: string,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseMediationSessions.sessionNumber) })
    .from(caseMediationSessions)
    .where(eq(caseMediationSessions.caseId, caseId));
  return ((row?.maxN ?? 0) as number) + 1;
}

export interface CreateSessionInput {
  orgId: string;
  caseId: string;
  mediatorName: string;
  mediatorFirm?: string | null;
  mediatorEmail?: string | null;
  mediatorPhone?: string | null;
  scheduledDate: Date;
  location?: string | null;
  sessionType?: MediationSessionType;
  durationMinutes?: number | null;
  costCents?: number | null;
  notes?: string | null;
  createdBy: string;
}

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ id: string; sessionNumber: number }> {
  const sessionNumber = await getNextSessionNumber(db, input.caseId);
  // If scheduledDate already past, default to 'completed' rather than 'scheduled'.
  const status: MediationStatus =
    input.scheduledDate.getTime() <= Date.now() ? "completed" : "scheduled";
  const [inserted] = await db
    .insert(caseMediationSessions)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      sessionNumber,
      mediatorName: input.mediatorName,
      mediatorFirm: input.mediatorFirm ?? null,
      mediatorEmail: input.mediatorEmail ?? null,
      mediatorPhone: input.mediatorPhone ?? null,
      scheduledDate: input.scheduledDate,
      location: input.location ?? null,
      sessionType: input.sessionType ?? "initial",
      status,
      outcome: "pending",
      durationMinutes: input.durationMinutes ?? null,
      costCents: input.costCents ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .returning({
      id: caseMediationSessions.id,
      sessionNumber: caseMediationSessions.sessionNumber,
    });
  return { id: inserted.id, sessionNumber: inserted.sessionNumber };
}

async function getRow(
  db: Db,
  sessionId: string,
): Promise<typeof caseMediationSessions.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseMediationSessions)
    .where(eq(caseMediationSessions.id, sessionId))
    .limit(1);
  if (!row) throw new Error("Mediation session not found");
  return row as typeof caseMediationSessions.$inferSelect;
}

export interface UpdateSessionPatch {
  mediatorName?: string;
  mediatorFirm?: string | null;
  mediatorEmail?: string | null;
  mediatorPhone?: string | null;
  scheduledDate?: Date;
  location?: string | null;
  sessionType?: MediationSessionType;
  durationMinutes?: number | null;
  costCents?: number | null;
  notes?: string | null;
}

export async function updateSession(
  db: Db,
  sessionId: string,
  patch: UpdateSessionPatch,
): Promise<void> {
  const row = await getRow(db, sessionId);
  const locked =
    row.status === "completed" || row.status === "cancelled";
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (locked) {
    // Only notes editable post-finalization.
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (Object.keys(update).length === 1) return; // nothing to write besides updatedAt
  } else {
    if (patch.mediatorName !== undefined) update.mediatorName = patch.mediatorName;
    if (patch.mediatorFirm !== undefined) update.mediatorFirm = patch.mediatorFirm;
    if (patch.mediatorEmail !== undefined) update.mediatorEmail = patch.mediatorEmail;
    if (patch.mediatorPhone !== undefined) update.mediatorPhone = patch.mediatorPhone;
    if (patch.scheduledDate !== undefined) update.scheduledDate = patch.scheduledDate;
    if (patch.location !== undefined) update.location = patch.location;
    if (patch.sessionType !== undefined) update.sessionType = patch.sessionType;
    if (patch.durationMinutes !== undefined) update.durationMinutes = patch.durationMinutes;
    if (patch.costCents !== undefined) update.costCents = patch.costCents;
    if (patch.notes !== undefined) update.notes = patch.notes;
  }
  await db
    .update(caseMediationSessions)
    .set(update)
    .where(eq(caseMediationSessions.id, sessionId));
}

export async function markStatus(
  db: Db,
  sessionId: string,
  status: MediationStatus,
): Promise<void> {
  await getRow(db, sessionId);
  await db
    .update(caseMediationSessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(caseMediationSessions.id, sessionId));
}

export async function markOutcome(
  db: Db,
  sessionId: string,
  outcome: MediationOutcome,
): Promise<void> {
  await getRow(db, sessionId);
  await db
    .update(caseMediationSessions)
    .set({ outcome, updatedAt: new Date() })
    .where(eq(caseMediationSessions.id, sessionId));
}

export async function deleteSession(
  db: Db,
  sessionId: string,
): Promise<void> {
  const row = await getRow(db, sessionId);
  if (row.status !== "scheduled" && row.status !== "cancelled") {
    throw new Error(
      "Only scheduled or cancelled mediation sessions can be deleted",
    );
  }
  await db
    .delete(caseMediationSessions)
    .where(eq(caseMediationSessions.id, sessionId));
}

export { caseMediationSessions };
