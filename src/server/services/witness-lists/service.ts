// src/server/services/witness-lists/service.ts
//
// Witness Lists service layer for ClearTerms 3.2.1 (Trial Prep Wave 1).
// Mirrors the discovery service shape — lists are the parent entity, witnesses
// are the children. Lifecycle: draft → final → served.

import { and, asc, eq, max } from "drizzle-orm";
import {
  caseWitnessLists,
  type WitnessListServingParty,
} from "@/server/db/schema/case-witness-lists";
import {
  caseWitnesses,
  type WitnessCategory,
  type WitnessPartyAffiliation,
} from "@/server/db/schema/case-witnesses";

type Db = any;

const CATEGORY_ORDER: Record<WitnessCategory, number> = {
  fact: 0,
  expert: 1,
  impeachment: 2,
  rebuttal: 3,
};

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseWitnessLists.$inferSelect & { witnessCount: number })[]> {
  const lists = await db
    .select()
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.caseId, caseId))
    .orderBy(asc(caseWitnessLists.servingParty), asc(caseWitnessLists.listNumber));

  // Per-list witness counts.
  const out: (typeof caseWitnessLists.$inferSelect & { witnessCount: number })[] = [];
  for (const l of lists as (typeof caseWitnessLists.$inferSelect)[]) {
    const witnesses = await db
      .select({ id: caseWitnesses.id })
      .from(caseWitnesses)
      .where(eq(caseWitnesses.listId, l.id));
    out.push({ ...l, witnessCount: witnesses.length });
  }
  return out;
}

export async function getList(
  db: Db,
  listId: string,
): Promise<{
  list: typeof caseWitnessLists.$inferSelect;
  witnesses: (typeof caseWitnesses.$inferSelect)[];
}> {
  const [list] = await db
    .select()
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.id, listId))
    .limit(1);
  if (!list) throw new Error("Witness list not found");
  const witnesses = await db
    .select()
    .from(caseWitnesses)
    .where(eq(caseWitnesses.listId, listId));
  // Sort: category (fact → expert → impeachment → rebuttal), then witnessOrder.
  const sorted = [...(witnesses as (typeof caseWitnesses.$inferSelect)[])].sort(
    (a, b) => {
      const ca = CATEGORY_ORDER[a.category as WitnessCategory] ?? 99;
      const cb = CATEGORY_ORDER[b.category as WitnessCategory] ?? 99;
      if (ca !== cb) return ca - cb;
      return a.witnessOrder - b.witnessOrder;
    },
  );
  return { list, witnesses: sorted };
}

export async function getNextListNumber(
  db: Db,
  caseId: string,
  servingParty: WitnessListServingParty,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseWitnessLists.listNumber) })
    .from(caseWitnessLists)
    .where(
      and(
        eq(caseWitnessLists.caseId, caseId),
        eq(caseWitnessLists.servingParty, servingParty),
      ),
    );
  return ((row?.maxN ?? 0) as number) + 1;
}

export interface CreateListInput {
  orgId: string;
  caseId: string;
  servingParty: WitnessListServingParty;
  listNumber: number;
  title: string;
  createdBy: string;
}

export async function createList(
  db: Db,
  input: CreateListInput,
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(caseWitnessLists)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      servingParty: input.servingParty,
      listNumber: input.listNumber,
      title: input.title,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: caseWitnessLists.id });
  return { id: inserted.id };
}

async function requireDraft(db: Db, listId: string): Promise<typeof caseWitnessLists.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.id, listId))
    .limit(1);
  if (!row) throw new Error("Witness list not found");
  if (row.status !== "draft") {
    throw new Error("Only draft witness lists can be edited");
  }
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
    .update(caseWitnessLists)
    .set(set)
    .where(eq(caseWitnessLists.id, listId));
}

export async function finalizeList(db: Db, listId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.id, listId))
    .limit(1);
  if (!row) throw new Error("Witness list not found");
  if (row.status !== "draft") {
    throw new Error("Only draft witness lists can be finalized");
  }
  const witnesses = await db
    .select({ id: caseWitnesses.id })
    .from(caseWitnesses)
    .where(eq(caseWitnesses.listId, listId));
  if ((witnesses as unknown[]).length === 0) {
    throw new Error("Cannot finalize a witness list with no witnesses");
  }
  await db
    .update(caseWitnessLists)
    .set({ status: "final", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseWitnessLists.id, listId));
}

export async function markServed(
  db: Db,
  listId: string,
  servedAt: Date,
): Promise<void> {
  const [row] = await db
    .select({ status: caseWitnessLists.status })
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.id, listId))
    .limit(1);
  if (!row) throw new Error("Witness list not found");
  if (row.status !== "final") {
    throw new Error("Witness list must be finalized before being served");
  }
  await db
    .update(caseWitnessLists)
    .set({ status: "served", servedAt, updatedAt: new Date() })
    .where(eq(caseWitnessLists.id, listId));
}

export async function deleteList(db: Db, listId: string): Promise<void> {
  const [row] = await db
    .select({ status: caseWitnessLists.status })
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.id, listId))
    .limit(1);
  if (!row) throw new Error("Witness list not found");
  if (row.status === "served") {
    throw new Error("Served witness lists cannot be deleted");
  }
  await db.delete(caseWitnessLists).where(eq(caseWitnessLists.id, listId));
}

export interface AddWitnessInput {
  category: WitnessCategory;
  partyAffiliation: WitnessPartyAffiliation;
  fullName: string;
  titleOrRole?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  expectedTestimony?: string | null;
  exhibitRefs?: string[];
  isWillCall?: boolean;
}

export async function addWitness(
  db: Db,
  listId: string,
  input: AddWitnessInput,
): Promise<{ id: string }> {
  await requireDraft(db, listId);
  const [row] = await db
    .select({ maxN: max(caseWitnesses.witnessOrder) })
    .from(caseWitnesses)
    .where(eq(caseWitnesses.listId, listId));
  const nextOrder = ((row?.maxN ?? 0) as number) + 1;
  const [inserted] = await db
    .insert(caseWitnesses)
    .values({
      listId,
      witnessOrder: nextOrder,
      category: input.category,
      partyAffiliation: input.partyAffiliation,
      fullName: input.fullName,
      titleOrRole: input.titleOrRole ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      expectedTestimony: input.expectedTestimony ?? null,
      exhibitRefs: input.exhibitRefs ?? [],
      isWillCall: input.isWillCall ?? true,
    })
    .returning({ id: caseWitnesses.id });
  return { id: inserted.id };
}

export interface UpdateWitnessPatch {
  category?: WitnessCategory;
  partyAffiliation?: WitnessPartyAffiliation;
  fullName?: string;
  titleOrRole?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  expectedTestimony?: string | null;
  exhibitRefs?: string[];
  isWillCall?: boolean;
}

async function requireDraftForWitness(
  db: Db,
  witnessId: string,
): Promise<typeof caseWitnesses.$inferSelect> {
  const [w] = await db
    .select()
    .from(caseWitnesses)
    .where(eq(caseWitnesses.id, witnessId))
    .limit(1);
  if (!w) throw new Error("Witness not found");
  await requireDraft(db, w.listId);
  return w;
}

export async function updateWitness(
  db: Db,
  witnessId: string,
  patch: UpdateWitnessPatch,
): Promise<void> {
  await requireDraftForWitness(db, witnessId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.partyAffiliation !== undefined) set.partyAffiliation = patch.partyAffiliation;
  if (patch.fullName !== undefined) set.fullName = patch.fullName;
  if (patch.titleOrRole !== undefined) set.titleOrRole = patch.titleOrRole;
  if (patch.address !== undefined) set.address = patch.address;
  if (patch.phone !== undefined) set.phone = patch.phone;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.expectedTestimony !== undefined) set.expectedTestimony = patch.expectedTestimony;
  if (patch.exhibitRefs !== undefined) set.exhibitRefs = patch.exhibitRefs;
  if (patch.isWillCall !== undefined) set.isWillCall = patch.isWillCall;
  await db
    .update(caseWitnesses)
    .set(set)
    .where(eq(caseWitnesses.id, witnessId));
}

export async function setExpectedTestimony(
  db: Db,
  witnessId: string,
  text: string,
): Promise<void> {
  await requireDraftForWitness(db, witnessId);
  await db
    .update(caseWitnesses)
    .set({ expectedTestimony: text, updatedAt: new Date() })
    .where(eq(caseWitnesses.id, witnessId));
}

export async function deleteWitness(db: Db, witnessId: string): Promise<void> {
  await requireDraftForWitness(db, witnessId);
  await db.delete(caseWitnesses).where(eq(caseWitnesses.id, witnessId));
}

/**
 * Bulk reorder witnesses inside a list. `orderedIds` is the desired order;
 * positions are renumbered 1..N. Two-pass to avoid violating the unique
 * (list_id, witness_order) constraint mid-update: first push everything to
 * a high temporary range, then drop into final positions.
 */
export async function reorderWitnesses(
  db: Db,
  listId: string,
  orderedIds: string[],
): Promise<void> {
  await requireDraft(db, listId);
  if (orderedIds.length === 0) return;
  const TEMP_OFFSET = 5000;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseWitnesses)
      .set({ witnessOrder: TEMP_OFFSET + i + 1, updatedAt: new Date() })
      .where(and(eq(caseWitnesses.listId, listId), eq(caseWitnesses.id, orderedIds[i])));
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseWitnesses)
      .set({ witnessOrder: i + 1, updatedAt: new Date() })
      .where(and(eq(caseWitnesses.listId, listId), eq(caseWitnesses.id, orderedIds[i])));
  }
}
