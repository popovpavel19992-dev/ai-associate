// src/server/services/settlement/demand-letters-service.ts
//
// Demand letter service for ClearTerms 3.4.
// Lifecycle:
//   draft → sent → (responded | no_response | rescinded)
// Edits/deletes only while draft. Sent letters are immutable except for
// recording response or rescinding.

import { desc, eq, max } from "drizzle-orm";
import {
  caseDemandLetters,
  type DemandLetterType,
  type DemandLetterMethod,
} from "@/server/db/schema/case-demand-letters";

type Db = any;

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseDemandLetters.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(caseDemandLetters)
    .where(eq(caseDemandLetters.caseId, caseId))
    .orderBy(desc(caseDemandLetters.letterNumber));
  return rows as (typeof caseDemandLetters.$inferSelect)[];
}

export async function getLetter(
  db: Db,
  letterId: string,
): Promise<typeof caseDemandLetters.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseDemandLetters)
    .where(eq(caseDemandLetters.id, letterId))
    .limit(1);
  if (!row) throw new Error("Demand letter not found");
  return row as typeof caseDemandLetters.$inferSelect;
}

export async function getNextLetterNumber(
  db: Db,
  caseId: string,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseDemandLetters.letterNumber) })
    .from(caseDemandLetters)
    .where(eq(caseDemandLetters.caseId, caseId));
  return ((row?.maxN ?? 0) as number) + 1;
}

export interface CreateLetterInput {
  orgId: string;
  caseId: string;
  letterType: DemandLetterType;
  recipientName: string;
  recipientAddress?: string | null;
  recipientEmail?: string | null;
  demandAmountCents?: number | null;
  currency?: string;
  deadlineDate?: string | null; // YYYY-MM-DD
  keyFacts?: string | null;
  legalBasis?: string | null;
  demandTerms?: string | null;
  letterBody?: string | null;
  createdBy: string;
}

export async function createLetter(
  db: Db,
  input: CreateLetterInput,
): Promise<{ id: string; letterNumber: number }> {
  const letterNumber = await getNextLetterNumber(db, input.caseId);
  const [inserted] = await db
    .insert(caseDemandLetters)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      letterNumber,
      letterType: input.letterType,
      recipientName: input.recipientName,
      recipientAddress: input.recipientAddress ?? null,
      recipientEmail: input.recipientEmail ?? null,
      demandAmountCents: input.demandAmountCents ?? null,
      currency: input.currency ?? "USD",
      deadlineDate: input.deadlineDate ?? null,
      keyFacts: input.keyFacts ?? null,
      legalBasis: input.legalBasis ?? null,
      demandTerms: input.demandTerms ?? null,
      letterBody: input.letterBody ?? null,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({
      id: caseDemandLetters.id,
      letterNumber: caseDemandLetters.letterNumber,
    });
  return { id: inserted.id, letterNumber: inserted.letterNumber };
}

async function getRow(
  db: Db,
  letterId: string,
): Promise<typeof caseDemandLetters.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseDemandLetters)
    .where(eq(caseDemandLetters.id, letterId))
    .limit(1);
  if (!row) throw new Error("Demand letter not found");
  return row as typeof caseDemandLetters.$inferSelect;
}

export interface UpdateLetterPatch {
  letterType?: DemandLetterType;
  recipientName?: string;
  recipientAddress?: string | null;
  recipientEmail?: string | null;
  demandAmountCents?: number | null;
  currency?: string;
  deadlineDate?: string | null;
  keyFacts?: string | null;
  legalBasis?: string | null;
  demandTerms?: string | null;
  letterBody?: string | null;
}

export async function updateLetter(
  db: Db,
  letterId: string,
  patch: UpdateLetterPatch,
): Promise<void> {
  const row = await getRow(db, letterId);
  if (row.status !== "draft") {
    throw new Error("Only draft demand letters can be edited");
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.letterType !== undefined) update.letterType = patch.letterType;
  if (patch.recipientName !== undefined) update.recipientName = patch.recipientName;
  if (patch.recipientAddress !== undefined)
    update.recipientAddress = patch.recipientAddress;
  if (patch.recipientEmail !== undefined) update.recipientEmail = patch.recipientEmail;
  if (patch.demandAmountCents !== undefined)
    update.demandAmountCents = patch.demandAmountCents;
  if (patch.currency !== undefined) update.currency = patch.currency;
  if (patch.deadlineDate !== undefined) update.deadlineDate = patch.deadlineDate;
  if (patch.keyFacts !== undefined) update.keyFacts = patch.keyFacts;
  if (patch.legalBasis !== undefined) update.legalBasis = patch.legalBasis;
  if (patch.demandTerms !== undefined) update.demandTerms = patch.demandTerms;
  if (patch.letterBody !== undefined) update.letterBody = patch.letterBody;
  await db
    .update(caseDemandLetters)
    .set(update)
    .where(eq(caseDemandLetters.id, letterId));
}

export interface MarkSentInput {
  sentAt: Date;
  sentMethod: DemandLetterMethod;
}

export async function markSent(
  db: Db,
  letterId: string,
  input: MarkSentInput,
): Promise<void> {
  const row = await getRow(db, letterId);
  if (row.status !== "draft") {
    throw new Error("Only draft demand letters can be marked sent");
  }
  await db
    .update(caseDemandLetters)
    .set({
      status: "sent",
      sentAt: input.sentAt,
      sentMethod: input.sentMethod,
      updatedAt: new Date(),
    })
    .where(eq(caseDemandLetters.id, letterId));
}

export interface RecordResponseInput {
  responseReceivedAt: Date;
  responseSummary?: string | null;
}

export async function recordResponse(
  db: Db,
  letterId: string,
  input: RecordResponseInput,
): Promise<void> {
  const row = await getRow(db, letterId);
  if (row.status !== "sent") {
    throw new Error("Demand letter must be sent before recording a response");
  }
  await db
    .update(caseDemandLetters)
    .set({
      status: "responded",
      responseReceivedAt: input.responseReceivedAt,
      responseSummary: input.responseSummary ?? null,
      updatedAt: new Date(),
    })
    .where(eq(caseDemandLetters.id, letterId));
}

export async function markNoResponse(
  db: Db,
  letterId: string,
): Promise<void> {
  const row = await getRow(db, letterId);
  if (row.status !== "sent") {
    throw new Error("Demand letter must be sent before marking no-response");
  }
  await db
    .update(caseDemandLetters)
    .set({ status: "no_response", updatedAt: new Date() })
    .where(eq(caseDemandLetters.id, letterId));
}

export async function markRescinded(
  db: Db,
  letterId: string,
): Promise<void> {
  const row = await getRow(db, letterId);
  if (row.status !== "sent") {
    throw new Error("Only sent demand letters can be rescinded");
  }
  await db
    .update(caseDemandLetters)
    .set({ status: "rescinded", updatedAt: new Date() })
    .where(eq(caseDemandLetters.id, letterId));
}

export async function deleteLetter(
  db: Db,
  letterId: string,
): Promise<void> {
  const row = await getRow(db, letterId);
  if (row.status !== "draft") {
    throw new Error("Only draft demand letters can be deleted");
  }
  await db
    .delete(caseDemandLetters)
    .where(eq(caseDemandLetters.id, letterId));
}

export { caseDemandLetters };
