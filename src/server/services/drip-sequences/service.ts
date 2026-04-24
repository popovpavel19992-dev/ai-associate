// src/server/services/drip-sequences/service.ts
import { TRPCError } from "@trpc/server";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { emailDripSequences } from "@/server/db/schema/email-drip-sequences";
import { emailDripSequenceSteps } from "@/server/db/schema/email-drip-sequence-steps";
import { emailDripEnrollments } from "@/server/db/schema/email-drip-enrollments";

export type CancellationReason = "reply" | "bounce" | "complaint" | "manual";

export interface CreateSequenceInput {
  orgId: string;
  createdBy: string;
  name: string;
  description?: string;
  steps: { templateId: string; delayDays: number }[];
}

export interface EnrollInput {
  sequenceId: string;
  orgId: string;
  clientContactId: string;
  caseId?: string;
  enrolledBy: string;
}

// Postgres unique-violation error code (drizzle / postgres-js surfaces this as `.code`).
const PG_UNIQUE_VIOLATION = "23505";

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function statusForReason(reason: CancellationReason): string {
  return `cancelled_${reason}`;
}

const TERMINAL_STATUSES = [
  "completed",
  "cancelled_reply",
  "cancelled_bounce",
  "cancelled_complaint",
  "cancelled_manual",
] as const;

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === PG_UNIQUE_VIOLATION;
}

// Minimal db typing — accepts the production drizzle handle and test mocks.
// Service-internal: use `any` to avoid a hard import-cycle with the typed db.
type AnyDb = any;

export async function createSequence(
  db: AnyDb,
  input: CreateSequenceInput,
): Promise<{ id: string }> {
  if (!input.name.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Name required" });
  }
  if (input.steps.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "At least one step required" });
  }
  if (input.steps.length > 10) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Max 10 steps per sequence" });
  }
  for (const s of input.steps) {
    if (s.delayDays < 0 || s.delayDays > 365) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "delayDays must be 0..365" });
    }
  }

  const id = await db.transaction(async (tx: AnyDb) => {
    const [row] = await tx
      .insert(emailDripSequences)
      .values({
        orgId: input.orgId,
        name: input.name.trim(),
        description: input.description ?? null,
        createdBy: input.createdBy,
      })
      .returning({ id: emailDripSequences.id });

    await tx.insert(emailDripSequenceSteps).values(
      input.steps.map((s, idx) => ({
        sequenceId: row.id,
        stepOrder: idx,
        templateId: s.templateId,
        delayDays: s.delayDays,
      })),
    );
    return row.id as string;
  });

  return { id };
}

export async function updateSequence(
  db: AnyDb,
  sequenceId: string,
  patch: Partial<{ name: string; description: string; isActive: boolean }>,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  await db.update(emailDripSequences).set(set).where(eq(emailDripSequences.id, sequenceId));
}

export async function replaceSteps(
  db: AnyDb,
  sequenceId: string,
  steps: { templateId: string; delayDays: number }[],
): Promise<void> {
  if (steps.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "At least one step required" });
  }
  if (steps.length > 10) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Max 10 steps per sequence" });
  }
  for (const s of steps) {
    if (s.delayDays < 0 || s.delayDays > 365) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "delayDays must be 0..365" });
    }
  }
  await db.transaction(async (tx: AnyDb) => {
    await tx
      .delete(emailDripSequenceSteps)
      .where(eq(emailDripSequenceSteps.sequenceId, sequenceId));
    await tx.insert(emailDripSequenceSteps).values(
      steps.map((s, idx) => ({
        sequenceId,
        stepOrder: idx,
        templateId: s.templateId,
        delayDays: s.delayDays,
      })),
    );
    await tx
      .update(emailDripSequences)
      .set({ updatedAt: new Date() })
      .where(eq(emailDripSequences.id, sequenceId));
  });
}

export async function deleteSequence(db: AnyDb, sequenceId: string): Promise<void> {
  // ON DELETE cascade handles steps. Enrollments use ON DELETE RESTRICT, so
  // PG raises 23503 (foreign_key_violation) if any enrollments reference it.
  try {
    await db.delete(emailDripSequences).where(eq(emailDripSequences.id, sequenceId));
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "23503") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Cannot delete sequence with existing enrollments",
      });
    }
    throw err;
  }
}

export async function enrollContact(
  db: AnyDb,
  input: EnrollInput,
): Promise<{ enrollmentId: string; firstSendAt: Date }> {
  // Validate sequence exists + belongs to this org, and load step[0].
  const [seq] = await db
    .select({ id: emailDripSequences.id, orgId: emailDripSequences.orgId, isActive: emailDripSequences.isActive })
    .from(emailDripSequences)
    .where(eq(emailDripSequences.id, input.sequenceId))
    .limit(1);
  if (!seq || seq.orgId !== input.orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Sequence not found" });
  }
  if (!seq.isActive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Sequence is not active" });
  }

  const [firstStep] = await db
    .select({ delayDays: emailDripSequenceSteps.delayDays })
    .from(emailDripSequenceSteps)
    .where(eq(emailDripSequenceSteps.sequenceId, input.sequenceId))
    .orderBy(asc(emailDripSequenceSteps.stepOrder))
    .limit(1);
  if (!firstStep) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Sequence has no steps" });
  }

  const now = new Date();
  const firstSendAt = addDays(now, firstStep.delayDays);

  try {
    const [row] = await db
      .insert(emailDripEnrollments)
      .values({
        sequenceId: input.sequenceId,
        clientContactId: input.clientContactId,
        caseId: input.caseId ?? null,
        orgId: input.orgId,
        status: "active",
        currentStepOrder: 0,
        nextSendAt: firstSendAt,
        enrolledBy: input.enrolledBy,
      })
      .returning({ id: emailDripEnrollments.id });
    return { enrollmentId: row.id as string, firstSendAt };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Contact already enrolled in this sequence",
      });
    }
    throw err;
  }
}

export async function cancelEnrollment(
  db: AnyDb,
  enrollmentId: string,
  reason: CancellationReason,
): Promise<void> {
  // No-op if already terminal — guarded by status filter.
  await db
    .update(emailDripEnrollments)
    .set({
      status: statusForReason(reason),
      cancelledAt: new Date(),
      nextSendAt: null,
    })
    .where(
      and(
        eq(emailDripEnrollments.id, enrollmentId),
        eq(emailDripEnrollments.status, "active"),
      ),
    );
}

export async function cancelEnrollmentsForContact(
  db: AnyDb,
  clientContactId: string,
  reason: CancellationReason,
): Promise<number> {
  const result = await db
    .update(emailDripEnrollments)
    .set({
      status: statusForReason(reason),
      cancelledAt: new Date(),
      nextSendAt: null,
    })
    .where(
      and(
        eq(emailDripEnrollments.clientContactId, clientContactId),
        eq(emailDripEnrollments.status, "active"),
      ),
    )
    .returning({ id: emailDripEnrollments.id });
  return Array.isArray(result) ? result.length : 0;
}

export async function dueEnrollments(
  db: AnyDb,
  now: Date,
  limit: number,
): Promise<
  Array<{
    enrollmentId: string;
    sequenceId: string;
    clientContactId: string;
    caseId: string | null;
    orgId: string;
    currentStepOrder: number;
  }>
> {
  const rows = await db
    .select({
      id: emailDripEnrollments.id,
      sequenceId: emailDripEnrollments.sequenceId,
      clientContactId: emailDripEnrollments.clientContactId,
      caseId: emailDripEnrollments.caseId,
      orgId: emailDripEnrollments.orgId,
      currentStepOrder: emailDripEnrollments.currentStepOrder,
      nextSendAt: emailDripEnrollments.nextSendAt,
    })
    .from(emailDripEnrollments)
    .where(
      and(
        eq(emailDripEnrollments.status, "active"),
        lte(emailDripEnrollments.nextSendAt, now),
      ),
    )
    .orderBy(asc(emailDripEnrollments.nextSendAt))
    .limit(limit);

  return rows.map((r: any) => ({
    enrollmentId: r.id,
    sequenceId: r.sequenceId,
    clientContactId: r.clientContactId,
    caseId: r.caseId,
    orgId: r.orgId,
    currentStepOrder: r.currentStepOrder,
  }));
}

export async function advanceEnrollment(
  db: AnyDb,
  enrollmentId: string,
): Promise<void> {
  await db.transaction(async (tx: AnyDb) => {
    const [enrollment] = await tx
      .select({
        id: emailDripEnrollments.id,
        sequenceId: emailDripEnrollments.sequenceId,
        currentStepOrder: emailDripEnrollments.currentStepOrder,
        status: emailDripEnrollments.status,
      })
      .from(emailDripEnrollments)
      .where(eq(emailDripEnrollments.id, enrollmentId))
      .limit(1);
    if (!enrollment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found" });
    }
    if (enrollment.status !== "active") {
      // Already terminal — nothing to advance.
      return;
    }

    const nextOrder = enrollment.currentStepOrder + 1;
    const [nextStep] = await tx
      .select({ delayDays: emailDripSequenceSteps.delayDays })
      .from(emailDripSequenceSteps)
      .where(
        and(
          eq(emailDripSequenceSteps.sequenceId, enrollment.sequenceId),
          eq(emailDripSequenceSteps.stepOrder, nextOrder),
        ),
      )
      .limit(1);

    const now = new Date();
    if (!nextStep) {
      // Past the end — mark complete.
      await tx
        .update(emailDripEnrollments)
        .set({
          status: "completed",
          completedAt: now,
          nextSendAt: null,
          lastStepSentAt: now,
          currentStepOrder: nextOrder,
        })
        .where(eq(emailDripEnrollments.id, enrollmentId));
      return;
    }

    const nextSendAt = addDays(now, nextStep.delayDays);
    await tx
      .update(emailDripEnrollments)
      .set({
        currentStepOrder: nextOrder,
        nextSendAt,
        lastStepSentAt: now,
      })
      .where(eq(emailDripEnrollments.id, enrollmentId));
  });
}

// ---------- Read helpers (used by tRPC) ----------

export async function listSequencesWithStepCount(db: AnyDb, orgId: string) {
  const rows = await db
    .select({
      id: emailDripSequences.id,
      name: emailDripSequences.name,
      description: emailDripSequences.description,
      isActive: emailDripSequences.isActive,
      createdAt: emailDripSequences.createdAt,
      updatedAt: emailDripSequences.updatedAt,
      stepCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${emailDripSequenceSteps}
        WHERE ${emailDripSequenceSteps.sequenceId} = ${emailDripSequences.id}
      ), 0)`,
    })
    .from(emailDripSequences)
    .where(eq(emailDripSequences.orgId, orgId))
    .orderBy(asc(emailDripSequences.name));
  return rows;
}

export async function getSequenceWithSteps(db: AnyDb, orgId: string, sequenceId: string) {
  const [seq] = await db
    .select()
    .from(emailDripSequences)
    .where(and(eq(emailDripSequences.id, sequenceId), eq(emailDripSequences.orgId, orgId)))
    .limit(1);
  if (!seq) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Sequence not found" });
  }
  const steps = await db
    .select()
    .from(emailDripSequenceSteps)
    .where(eq(emailDripSequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(emailDripSequenceSteps.stepOrder));
  return { sequence: seq, steps };
}

export async function listEnrollmentsForCase(db: AnyDb, orgId: string, caseId: string) {
  return db
    .select()
    .from(emailDripEnrollments)
    .where(
      and(
        eq(emailDripEnrollments.orgId, orgId),
        eq(emailDripEnrollments.caseId, caseId),
      ),
    )
    .orderBy(asc(emailDripEnrollments.enrolledAt));
}

export async function listEnrollmentsForContact(db: AnyDb, orgId: string, clientContactId: string) {
  return db
    .select()
    .from(emailDripEnrollments)
    .where(
      and(
        eq(emailDripEnrollments.orgId, orgId),
        eq(emailDripEnrollments.clientContactId, clientContactId),
      ),
    )
    .orderBy(asc(emailDripEnrollments.enrolledAt));
}

export async function getEnrollment(db: AnyDb, enrollmentId: string) {
  const [row] = await db
    .select()
    .from(emailDripEnrollments)
    .where(eq(emailDripEnrollments.id, enrollmentId))
    .limit(1);
  return row ?? null;
}

export const __testing = { addDays, statusForReason, TERMINAL_STATUSES, PG_UNIQUE_VIOLATION };
