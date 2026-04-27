// src/server/services/subpoenas/service.ts
//
// Subpoena service layer for ClearTerms 3.1.7 (FRCP 45 — AO 88 family).
// One row per subpoena. Lifecycle:
//   draft → issued → served → (complied | objected | quashed)
// State guards:
//   - updateSubpoena: only when status='draft'
//   - markIssued:     only from 'draft' (also stamps date_issued)
//   - markServed:     only from 'issued'
//   - markComplied / markObjected / markQuashed: only from 'served'
//   - deleteSubpoena: only when status='draft' (post-issuance preserves audit
//     trail — court can compel production of the served subpoena and
//     attorneys must not silently destroy that history)

import { and, asc, desc, eq, max } from "drizzle-orm";
import {
  caseSubpoenas,
  type SubpoenaIssuingParty,
  type SubpoenaServedMethod,
  type SubpoenaStatus,
  type SubpoenaType,
} from "@/server/db/schema/case-subpoenas";

type Db = any;

// ── Queries ──────────────────────────────────────────────────────────────

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseSubpoenas.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(caseSubpoenas)
    .where(eq(caseSubpoenas.caseId, caseId))
    .orderBy(desc(caseSubpoenas.subpoenaNumber));
  return rows as (typeof caseSubpoenas.$inferSelect)[];
}

export async function getSubpoena(
  db: Db,
  subpoenaId: string,
): Promise<typeof caseSubpoenas.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseSubpoenas)
    .where(eq(caseSubpoenas.id, subpoenaId))
    .limit(1);
  if (!row) throw new Error("Subpoena not found");
  return row as typeof caseSubpoenas.$inferSelect;
}

export async function getNextSubpoenaNumber(
  db: Db,
  caseId: string,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseSubpoenas.subpoenaNumber) })
    .from(caseSubpoenas)
    .where(eq(caseSubpoenas.caseId, caseId));
  return ((row?.maxN ?? 0) as number) + 1;
}

// ── Mutations ────────────────────────────────────────────────────────────

export interface CreateSubpoenaInput {
  orgId: string;
  caseId: string;
  subpoenaType: SubpoenaType;
  issuingParty: SubpoenaIssuingParty;
  issuingAttorneyId?: string | null;
  recipientName: string;
  recipientAddress?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  complianceDate?: string | null; // YYYY-MM-DD
  complianceLocation?: string | null;
  documentsRequested?: string[];
  testimonyTopics?: string[];
  notes?: string | null;
  createdBy: string;
}

export async function createSubpoena(
  db: Db,
  input: CreateSubpoenaInput,
): Promise<{ id: string; subpoenaNumber: number }> {
  const subpoenaNumber = await getNextSubpoenaNumber(db, input.caseId);
  const [inserted] = await db
    .insert(caseSubpoenas)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      subpoenaNumber,
      subpoenaType: input.subpoenaType,
      issuingParty: input.issuingParty,
      issuingAttorneyId: input.issuingAttorneyId ?? null,
      recipientName: input.recipientName,
      recipientAddress: input.recipientAddress ?? null,
      recipientEmail: input.recipientEmail ?? null,
      recipientPhone: input.recipientPhone ?? null,
      complianceDate: input.complianceDate ?? null,
      complianceLocation: input.complianceLocation ?? null,
      documentsRequested: input.documentsRequested ?? [],
      testimonyTopics: input.testimonyTopics ?? [],
      notes: input.notes ?? null,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({
      id: caseSubpoenas.id,
      subpoenaNumber: caseSubpoenas.subpoenaNumber,
    });
  return { id: inserted.id, subpoenaNumber: inserted.subpoenaNumber };
}

async function getRow(
  db: Db,
  subpoenaId: string,
): Promise<typeof caseSubpoenas.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseSubpoenas)
    .where(eq(caseSubpoenas.id, subpoenaId))
    .limit(1);
  if (!row) throw new Error("Subpoena not found");
  return row as typeof caseSubpoenas.$inferSelect;
}

export interface UpdateSubpoenaPatch {
  subpoenaType?: SubpoenaType;
  issuingParty?: SubpoenaIssuingParty;
  issuingAttorneyId?: string | null;
  recipientName?: string;
  recipientAddress?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  complianceDate?: string | null;
  complianceLocation?: string | null;
  documentsRequested?: string[];
  testimonyTopics?: string[];
  notes?: string | null;
}

export async function updateSubpoena(
  db: Db,
  subpoenaId: string,
  patch: UpdateSubpoenaPatch,
): Promise<void> {
  const row = await getRow(db, subpoenaId);
  if (row.status !== "draft") {
    throw new Error("Only draft subpoenas can be edited");
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.subpoenaType !== undefined) update.subpoenaType = patch.subpoenaType;
  if (patch.issuingParty !== undefined) update.issuingParty = patch.issuingParty;
  if (patch.issuingAttorneyId !== undefined)
    update.issuingAttorneyId = patch.issuingAttorneyId;
  if (patch.recipientName !== undefined) update.recipientName = patch.recipientName;
  if (patch.recipientAddress !== undefined)
    update.recipientAddress = patch.recipientAddress;
  if (patch.recipientEmail !== undefined) update.recipientEmail = patch.recipientEmail;
  if (patch.recipientPhone !== undefined) update.recipientPhone = patch.recipientPhone;
  if (patch.complianceDate !== undefined) update.complianceDate = patch.complianceDate;
  if (patch.complianceLocation !== undefined)
    update.complianceLocation = patch.complianceLocation;
  if (patch.documentsRequested !== undefined)
    update.documentsRequested = patch.documentsRequested;
  if (patch.testimonyTopics !== undefined)
    update.testimonyTopics = patch.testimonyTopics;
  if (patch.notes !== undefined) update.notes = patch.notes;

  await db
    .update(caseSubpoenas)
    .set(update)
    .where(eq(caseSubpoenas.id, subpoenaId));
}

export async function markIssued(
  db: Db,
  subpoenaId: string,
  dateIssued: string, // YYYY-MM-DD
): Promise<void> {
  const row = await getRow(db, subpoenaId);
  if (row.status !== "draft") {
    throw new Error("Only draft subpoenas can be issued");
  }
  await db
    .update(caseSubpoenas)
    .set({ status: "issued", dateIssued, updatedAt: new Date() })
    .where(eq(caseSubpoenas.id, subpoenaId));
}

export async function markServed(
  db: Db,
  subpoenaId: string,
  input: {
    servedAt: Date;
    servedByName: string;
    servedMethod: SubpoenaServedMethod;
  },
): Promise<void> {
  const row = await getRow(db, subpoenaId);
  if (row.status !== "issued") {
    throw new Error("Only issued subpoenas can be marked served");
  }
  await db
    .update(caseSubpoenas)
    .set({
      status: "served",
      servedAt: input.servedAt,
      servedByName: input.servedByName,
      servedMethod: input.servedMethod,
      updatedAt: new Date(),
    })
    .where(eq(caseSubpoenas.id, subpoenaId));
}

async function transitionFromServed(
  db: Db,
  subpoenaId: string,
  next: SubpoenaStatus,
): Promise<void> {
  const row = await getRow(db, subpoenaId);
  if (row.status !== "served") {
    throw new Error(`Subpoena must be served before being marked ${next}`);
  }
  await db
    .update(caseSubpoenas)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(caseSubpoenas.id, subpoenaId));
}

export function markComplied(db: Db, subpoenaId: string): Promise<void> {
  return transitionFromServed(db, subpoenaId, "complied");
}

export function markObjected(db: Db, subpoenaId: string): Promise<void> {
  return transitionFromServed(db, subpoenaId, "objected");
}

export function markQuashed(db: Db, subpoenaId: string): Promise<void> {
  return transitionFromServed(db, subpoenaId, "quashed");
}

export async function deleteSubpoena(db: Db, subpoenaId: string): Promise<void> {
  const row = await getRow(db, subpoenaId);
  if (row.status !== "draft") {
    throw new Error("Only draft subpoenas can be deleted (audit trail)");
  }
  await db.delete(caseSubpoenas).where(eq(caseSubpoenas.id, subpoenaId));
}

// Re-exports purely for tests/consumers.
export { caseSubpoenas };
export const __testing = { getRow, getNextSubpoenaNumber };
// Suppress unused import warning if tree-shaking strips and/asc.
void and;
void asc;
