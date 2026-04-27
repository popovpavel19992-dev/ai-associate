// src/server/services/settlement/offers-service.ts
//
// Settlement offer service for ClearTerms 3.4.
// Lifecycle: response='pending' → response='accepted'|'rejected'|'expired'|'withdrawn' (terminal).
// Edits and deletes only allowed while response='pending'.

import { desc, eq, max } from "drizzle-orm";
import {
  caseSettlementOffers,
  type SettlementOfferType,
  type SettlementFromParty,
  type SettlementResponse,
} from "@/server/db/schema/case-settlement-offers";

type Db = any;

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseSettlementOffers.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(caseSettlementOffers)
    .where(eq(caseSettlementOffers.caseId, caseId))
    .orderBy(desc(caseSettlementOffers.offerNumber));
  return rows as (typeof caseSettlementOffers.$inferSelect)[];
}

export async function getOffer(
  db: Db,
  offerId: string,
): Promise<typeof caseSettlementOffers.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseSettlementOffers)
    .where(eq(caseSettlementOffers.id, offerId))
    .limit(1);
  if (!row) throw new Error("Settlement offer not found");
  return row as typeof caseSettlementOffers.$inferSelect;
}

export async function getNextOfferNumber(
  db: Db,
  caseId: string,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseSettlementOffers.offerNumber) })
    .from(caseSettlementOffers)
    .where(eq(caseSettlementOffers.caseId, caseId));
  return ((row?.maxN ?? 0) as number) + 1;
}

export interface CreateOfferInput {
  orgId: string;
  caseId: string;
  amountCents: number;
  currency?: string;
  offerType: SettlementOfferType;
  fromParty: SettlementFromParty;
  offeredAt?: Date;
  expiresAt?: Date | null;
  terms?: string | null;
  conditions?: string | null;
  notes?: string | null;
  createdBy: string;
}

export async function createOffer(
  db: Db,
  input: CreateOfferInput,
): Promise<{ id: string; offerNumber: number }> {
  const offerNumber = await getNextOfferNumber(db, input.caseId);
  const [inserted] = await db
    .insert(caseSettlementOffers)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      offerNumber,
      amountCents: input.amountCents,
      currency: input.currency ?? "USD",
      offerType: input.offerType,
      fromParty: input.fromParty,
      offeredAt: input.offeredAt ?? new Date(),
      expiresAt: input.expiresAt ?? null,
      terms: input.terms ?? null,
      conditions: input.conditions ?? null,
      notes: input.notes ?? null,
      response: "pending",
      createdBy: input.createdBy,
    })
    .returning({
      id: caseSettlementOffers.id,
      offerNumber: caseSettlementOffers.offerNumber,
    });
  return { id: inserted.id, offerNumber: inserted.offerNumber };
}

async function getRow(
  db: Db,
  offerId: string,
): Promise<typeof caseSettlementOffers.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseSettlementOffers)
    .where(eq(caseSettlementOffers.id, offerId))
    .limit(1);
  if (!row) throw new Error("Settlement offer not found");
  return row as typeof caseSettlementOffers.$inferSelect;
}

export interface UpdateOfferPatch {
  amountCents?: number;
  currency?: string;
  offerType?: SettlementOfferType;
  fromParty?: SettlementFromParty;
  offeredAt?: Date;
  expiresAt?: Date | null;
  terms?: string | null;
  conditions?: string | null;
  notes?: string | null;
}

export async function updateOffer(
  db: Db,
  offerId: string,
  patch: UpdateOfferPatch,
): Promise<void> {
  const row = await getRow(db, offerId);
  if (row.response !== "pending") {
    throw new Error("Only pending settlement offers can be edited");
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.amountCents !== undefined) update.amountCents = patch.amountCents;
  if (patch.currency !== undefined) update.currency = patch.currency;
  if (patch.offerType !== undefined) update.offerType = patch.offerType;
  if (patch.fromParty !== undefined) update.fromParty = patch.fromParty;
  if (patch.offeredAt !== undefined) update.offeredAt = patch.offeredAt;
  if (patch.expiresAt !== undefined) update.expiresAt = patch.expiresAt;
  if (patch.terms !== undefined) update.terms = patch.terms;
  if (patch.conditions !== undefined) update.conditions = patch.conditions;
  if (patch.notes !== undefined) update.notes = patch.notes;
  await db
    .update(caseSettlementOffers)
    .set(update)
    .where(eq(caseSettlementOffers.id, offerId));
}

export interface RecordResponseInput {
  response: Exclude<SettlementResponse, "pending">;
  responseDate?: Date;
  responseNotes?: string | null;
}

export async function recordResponse(
  db: Db,
  offerId: string,
  input: RecordResponseInput,
): Promise<void> {
  const row = await getRow(db, offerId);
  if (row.response !== "pending") {
    throw new Error("Settlement offer response is already recorded");
  }
  await db
    .update(caseSettlementOffers)
    .set({
      response: input.response,
      responseDate: input.responseDate ?? new Date(),
      responseNotes: input.responseNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(caseSettlementOffers.id, offerId));
}

export async function deleteOffer(db: Db, offerId: string): Promise<void> {
  const row = await getRow(db, offerId);
  if (row.response !== "pending") {
    throw new Error("Only pending settlement offers can be deleted");
  }
  await db
    .delete(caseSettlementOffers)
    .where(eq(caseSettlementOffers.id, offerId));
}

export { caseSettlementOffers };
