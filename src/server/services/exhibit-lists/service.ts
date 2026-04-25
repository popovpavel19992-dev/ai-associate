// src/server/services/exhibit-lists/service.ts
//
// Trial Exhibit List service layer for ClearTerms 3.2.2 (Trial Prep Wave 2).
// Mirrors the witness-lists service. Lists are the parent; exhibits are rows.
// Lifecycle: draft → final → served. Admission status (proposed / admitted /
// objected / etc.) remains editable at trial even after the list is served.
//
// Auto-labeling: P-1, P-2, ... for plaintiff-served lists; D-1, D-2, ... for
// defendant. Reorder re-flows labels to keep them in sequence with order.

import { and, asc, eq, max } from "drizzle-orm";
import {
  caseExhibitLists,
  type ExhibitListServingParty,
} from "@/server/db/schema/case-exhibit-lists";
import {
  caseExhibits,
  type ExhibitDocType,
  type ExhibitAdmissionStatus,
} from "@/server/db/schema/case-exhibits";

type Db = any;

function labelFor(servingParty: ExhibitListServingParty, order: number): string {
  const prefix = servingParty === "plaintiff" ? "P" : "D";
  return `${prefix}-${order}`;
}

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseExhibitLists.$inferSelect & { exhibitCount: number })[]> {
  const lists = await db
    .select()
    .from(caseExhibitLists)
    .where(eq(caseExhibitLists.caseId, caseId))
    .orderBy(asc(caseExhibitLists.servingParty), asc(caseExhibitLists.listNumber));

  const out: (typeof caseExhibitLists.$inferSelect & { exhibitCount: number })[] = [];
  for (const l of lists as (typeof caseExhibitLists.$inferSelect)[]) {
    const exhibits = await db
      .select({ id: caseExhibits.id })
      .from(caseExhibits)
      .where(eq(caseExhibits.listId, l.id));
    out.push({ ...l, exhibitCount: (exhibits as unknown[]).length });
  }
  return out;
}

export async function getList(
  db: Db,
  listId: string,
): Promise<{
  list: typeof caseExhibitLists.$inferSelect;
  exhibits: (typeof caseExhibits.$inferSelect)[];
}> {
  const [list] = await db
    .select()
    .from(caseExhibitLists)
    .where(eq(caseExhibitLists.id, listId))
    .limit(1);
  if (!list) throw new Error("Exhibit list not found");
  const exhibits = await db
    .select()
    .from(caseExhibits)
    .where(eq(caseExhibits.listId, listId))
    .orderBy(asc(caseExhibits.exhibitOrder));
  return { list, exhibits: exhibits as (typeof caseExhibits.$inferSelect)[] };
}

export async function getNextListNumber(
  db: Db,
  caseId: string,
  servingParty: ExhibitListServingParty,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseExhibitLists.listNumber) })
    .from(caseExhibitLists)
    .where(
      and(
        eq(caseExhibitLists.caseId, caseId),
        eq(caseExhibitLists.servingParty, servingParty),
      ),
    );
  return ((row?.maxN ?? 0) as number) + 1;
}

export interface CreateListInput {
  orgId: string;
  caseId: string;
  servingParty: ExhibitListServingParty;
  listNumber: number;
  title: string;
  createdBy: string;
}

export async function createList(
  db: Db,
  input: CreateListInput,
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(caseExhibitLists)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      servingParty: input.servingParty,
      listNumber: input.listNumber,
      title: input.title,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: caseExhibitLists.id });
  return { id: inserted.id };
}

async function requireDraft(
  db: Db,
  listId: string,
): Promise<typeof caseExhibitLists.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseExhibitLists)
    .where(eq(caseExhibitLists.id, listId))
    .limit(1);
  if (!row) throw new Error("Exhibit list not found");
  if (row.status !== "draft") {
    throw new Error("Only draft exhibit lists can be edited");
  }
  return row;
}

async function getListRow(
  db: Db,
  listId: string,
): Promise<typeof caseExhibitLists.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseExhibitLists)
    .where(eq(caseExhibitLists.id, listId))
    .limit(1);
  if (!row) throw new Error("Exhibit list not found");
  return row;
}

export async function updateListMeta(
  db: Db,
  listId: string,
  patch: { title?: string },
): Promise<void> {
  await requireDraft(db, listId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  await db
    .update(caseExhibitLists)
    .set(set)
    .where(eq(caseExhibitLists.id, listId));
}

export async function finalizeList(db: Db, listId: string): Promise<void> {
  const row = await getListRow(db, listId);
  if (row.status !== "draft") {
    throw new Error("Only draft exhibit lists can be finalized");
  }
  const exhibits = await db
    .select({ id: caseExhibits.id })
    .from(caseExhibits)
    .where(eq(caseExhibits.listId, listId));
  if ((exhibits as unknown[]).length === 0) {
    throw new Error("Cannot finalize an exhibit list with no exhibits");
  }
  await db
    .update(caseExhibitLists)
    .set({ status: "final", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseExhibitLists.id, listId));
}

export async function markServed(
  db: Db,
  listId: string,
  servedAt: Date,
): Promise<void> {
  const row = await getListRow(db, listId);
  if (row.status !== "final") {
    throw new Error("Exhibit list must be finalized before being served");
  }
  await db
    .update(caseExhibitLists)
    .set({ status: "served", servedAt, updatedAt: new Date() })
    .where(eq(caseExhibitLists.id, listId));
}

export async function deleteList(db: Db, listId: string): Promise<void> {
  const row = await getListRow(db, listId);
  if (row.status === "served") {
    throw new Error("Served exhibit lists cannot be deleted");
  }
  await db.delete(caseExhibitLists).where(eq(caseExhibitLists.id, listId));
}

export interface AddExhibitInput {
  description: string;
  docType?: ExhibitDocType;
  exhibitDate?: string | null;
  sponsoringWitnessId?: string | null;
  sponsoringWitnessName?: string | null;
  admissionStatus?: ExhibitAdmissionStatus;
  batesRange?: string | null;
  sourceDocumentId?: string | null;
  notes?: string | null;
}

export async function addExhibit(
  db: Db,
  listId: string,
  input: AddExhibitInput,
): Promise<{ id: string }> {
  const list = await requireDraft(db, listId);
  const [row] = await db
    .select({ maxN: max(caseExhibits.exhibitOrder) })
    .from(caseExhibits)
    .where(eq(caseExhibits.listId, listId));
  const nextOrder = ((row?.maxN ?? 0) as number) + 1;
  const label = labelFor(list.servingParty, nextOrder);
  const [inserted] = await db
    .insert(caseExhibits)
    .values({
      listId,
      exhibitOrder: nextOrder,
      exhibitLabel: label,
      description: input.description,
      docType: input.docType ?? "document",
      exhibitDate: input.exhibitDate ?? null,
      sponsoringWitnessId: input.sponsoringWitnessId ?? null,
      sponsoringWitnessName: input.sponsoringWitnessName ?? null,
      admissionStatus: input.admissionStatus ?? "proposed",
      batesRange: input.batesRange ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: caseExhibits.id });
  return { id: inserted.id };
}

export interface UpdateExhibitPatch {
  description?: string;
  docType?: ExhibitDocType;
  exhibitDate?: string | null;
  sponsoringWitnessId?: string | null;
  sponsoringWitnessName?: string | null;
  batesRange?: string | null;
  sourceDocumentId?: string | null;
  notes?: string | null;
}

async function getExhibitRow(
  db: Db,
  exhibitId: string,
): Promise<typeof caseExhibits.$inferSelect> {
  const [w] = await db
    .select()
    .from(caseExhibits)
    .where(eq(caseExhibits.id, exhibitId))
    .limit(1);
  if (!w) throw new Error("Exhibit not found");
  return w;
}

export async function updateExhibit(
  db: Db,
  exhibitId: string,
  patch: UpdateExhibitPatch,
): Promise<void> {
  const ex = await getExhibitRow(db, exhibitId);
  await requireDraft(db, ex.listId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.docType !== undefined) set.docType = patch.docType;
  if (patch.exhibitDate !== undefined) set.exhibitDate = patch.exhibitDate;
  if (patch.sponsoringWitnessId !== undefined) set.sponsoringWitnessId = patch.sponsoringWitnessId;
  if (patch.sponsoringWitnessName !== undefined) set.sponsoringWitnessName = patch.sponsoringWitnessName;
  if (patch.batesRange !== undefined) set.batesRange = patch.batesRange;
  if (patch.sourceDocumentId !== undefined) set.sourceDocumentId = patch.sourceDocumentId;
  if (patch.notes !== undefined) set.notes = patch.notes;
  await db
    .update(caseExhibits)
    .set(set)
    .where(eq(caseExhibits.id, exhibitId));
}

/**
 * Update an exhibit's admission status. Allowed at any list status (including
 * `served` and `closed`) so the admission state can be tracked live during trial.
 */
export async function updateAdmissionStatus(
  db: Db,
  exhibitId: string,
  status: ExhibitAdmissionStatus,
): Promise<void> {
  await getExhibitRow(db, exhibitId);
  await db
    .update(caseExhibits)
    .set({ admissionStatus: status, updatedAt: new Date() })
    .where(eq(caseExhibits.id, exhibitId));
}

export async function deleteExhibit(db: Db, exhibitId: string): Promise<void> {
  const ex = await getExhibitRow(db, exhibitId);
  await requireDraft(db, ex.listId);
  await db.delete(caseExhibits).where(eq(caseExhibits.id, exhibitId));
}

/**
 * Bulk reorder exhibits in a list. `orderedIds` is the desired sequence;
 * positions and labels are renumbered 1..N. Three-pass to dodge the unique
 * (list_id, exhibit_order) and (list_id, exhibit_label) constraints
 * mid-update: stash both fields into a temporary range, then commit final
 * orders, then commit final labels.
 */
export async function reorderExhibits(
  db: Db,
  listId: string,
  orderedIds: string[],
): Promise<void> {
  const list = await requireDraft(db, listId);
  if (orderedIds.length === 0) return;
  const TEMP_OFFSET = 5000;
  // Pass 1: push every row's order + label into the temp range, free of conflicts.
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseExhibits)
      .set({
        exhibitOrder: TEMP_OFFSET + i + 1,
        exhibitLabel: `__TMP-${TEMP_OFFSET + i + 1}`,
        updatedAt: new Date(),
      })
      .where(and(eq(caseExhibits.listId, listId), eq(caseExhibits.id, orderedIds[i])));
  }
  // Pass 2: drop into final order + label.
  for (let i = 0; i < orderedIds.length; i++) {
    const finalOrder = i + 1;
    await db
      .update(caseExhibits)
      .set({
        exhibitOrder: finalOrder,
        exhibitLabel: labelFor(list.servingParty, finalOrder),
        updatedAt: new Date(),
      })
      .where(and(eq(caseExhibits.listId, listId), eq(caseExhibits.id, orderedIds[i])));
  }
}
