// src/server/services/privilege-log/service.ts
//
// Privilege log service for ClearTerms 3.1.5. Manual CRUD over
// case_privilege_log_entries; no AI for MVP. Per FRCP 26(b)(5)(A) gaps in
// numbering are acceptable on a privilege log — we deliberately do NOT
// renumber on delete. Lawyers can edit entry_number directly to reorder.

import { and, asc, eq, max } from "drizzle-orm";
import {
  casePrivilegeLogEntries,
  type CasePrivilegeLogEntry,
  type PrivilegeBasis,
} from "@/server/db/schema/case-privilege-log-entries";

type Db = any;

export interface CreatePrivilegeLogEntryInput {
  orgId: string;
  caseId: string;
  relatedRequestId?: string | null;
  entryNumber?: number;
  documentDate?: string | null;
  documentType?: string | null;
  author?: string | null;
  recipients?: string[];
  cc?: string[];
  subject?: string | null;
  description?: string | null;
  privilegeBasis: PrivilegeBasis;
  basisExplanation?: string | null;
  withheldBy: "plaintiff" | "defendant";
  batesRange?: string | null;
  createdBy: string;
}

export interface UpdatePrivilegeLogEntryInput {
  relatedRequestId?: string | null;
  entryNumber?: number;
  documentDate?: string | null;
  documentType?: string | null;
  author?: string | null;
  recipients?: string[];
  cc?: string[];
  subject?: string | null;
  description?: string | null;
  privilegeBasis?: PrivilegeBasis;
  basisExplanation?: string | null;
  withheldBy?: "plaintiff" | "defendant";
  batesRange?: string | null;
}

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<CasePrivilegeLogEntry[]> {
  return db
    .select()
    .from(casePrivilegeLogEntries)
    .where(eq(casePrivilegeLogEntries.caseId, caseId))
    .orderBy(asc(casePrivilegeLogEntries.entryNumber));
}

export async function listForRequest(
  db: Db,
  requestId: string,
): Promise<CasePrivilegeLogEntry[]> {
  return db
    .select()
    .from(casePrivilegeLogEntries)
    .where(eq(casePrivilegeLogEntries.relatedRequestId, requestId))
    .orderBy(asc(casePrivilegeLogEntries.entryNumber));
}

export async function getNextEntryNumber(
  db: Db,
  caseId: string,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(casePrivilegeLogEntries.entryNumber) })
    .from(casePrivilegeLogEntries)
    .where(eq(casePrivilegeLogEntries.caseId, caseId));
  const current = row?.maxN ?? null;
  return (current ?? 0) + 1;
}

export async function getEntry(
  db: Db,
  id: string,
): Promise<CasePrivilegeLogEntry> {
  const [row] = await db
    .select()
    .from(casePrivilegeLogEntries)
    .where(eq(casePrivilegeLogEntries.id, id))
    .limit(1);
  if (!row) throw new Error("Privilege log entry not found");
  return row;
}

export async function createEntry(
  db: Db,
  input: CreatePrivilegeLogEntryInput,
): Promise<{ id: string; entryNumber: number }> {
  const entryNumber =
    input.entryNumber ?? (await getNextEntryNumber(db, input.caseId));

  const [inserted] = await db
    .insert(casePrivilegeLogEntries)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      relatedRequestId: input.relatedRequestId ?? null,
      entryNumber,
      documentDate: input.documentDate ?? null,
      documentType: input.documentType ?? null,
      author: input.author ?? null,
      recipients: input.recipients ?? [],
      cc: input.cc ?? [],
      subject: input.subject ?? null,
      description: input.description ?? null,
      privilegeBasis: input.privilegeBasis,
      basisExplanation: input.basisExplanation ?? null,
      withheldBy: input.withheldBy,
      batesRange: input.batesRange ?? null,
      createdBy: input.createdBy,
    })
    .returning({
      id: casePrivilegeLogEntries.id,
      entryNumber: casePrivilegeLogEntries.entryNumber,
    });
  return { id: inserted.id, entryNumber: inserted.entryNumber };
}

export async function updateEntry(
  db: Db,
  id: string,
  patch: UpdatePrivilegeLogEntryInput,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(casePrivilegeLogEntries)
    .where(eq(casePrivilegeLogEntries.id, id))
    .limit(1);
  if (!existing) throw new Error("Privilege log entry not found");

  // If renumbering, validate uniqueness within the case.
  if (
    patch.entryNumber !== undefined &&
    patch.entryNumber !== existing.entryNumber
  ) {
    const [conflict] = await db
      .select({ id: casePrivilegeLogEntries.id })
      .from(casePrivilegeLogEntries)
      .where(
        and(
          eq(casePrivilegeLogEntries.caseId, existing.caseId),
          eq(casePrivilegeLogEntries.entryNumber, patch.entryNumber),
        ),
      )
      .limit(1);
    if (conflict) {
      throw new Error(
        `entry_number ${patch.entryNumber} already in use for this case`,
      );
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const fields: Array<keyof UpdatePrivilegeLogEntryInput> = [
    "relatedRequestId",
    "entryNumber",
    "documentDate",
    "documentType",
    "author",
    "recipients",
    "cc",
    "subject",
    "description",
    "privilegeBasis",
    "basisExplanation",
    "withheldBy",
    "batesRange",
  ];
  for (const f of fields) {
    if (patch[f] !== undefined) set[f as string] = patch[f];
  }

  await db
    .update(casePrivilegeLogEntries)
    .set(set)
    .where(eq(casePrivilegeLogEntries.id, id));
}

export async function deleteEntry(db: Db, id: string): Promise<void> {
  // Per practice — a gap in the privilege-log numbering is acceptable and
  // sometimes desirable (preserves a stable reference for already-served
  // logs). We deliberately do NOT renumber subsequent entries on delete.
  await db
    .delete(casePrivilegeLogEntries)
    .where(eq(casePrivilegeLogEntries.id, id));
}

export async function reorder(
  db: Db,
  caseId: string,
  orderedIds: string[],
): Promise<void> {
  // Two-phase: first move every target row to a high "scratch" entry_number
  // outside the legal range, then assign the final 1..N. This avoids
  // unique-constraint conflicts mid-update.
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(casePrivilegeLogEntries)
      .set({ entryNumber: 9999 - i, updatedAt: new Date() })
      .where(
        and(
          eq(casePrivilegeLogEntries.caseId, caseId),
          eq(casePrivilegeLogEntries.id, orderedIds[i]),
        ),
      );
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(casePrivilegeLogEntries)
      .set({ entryNumber: i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(casePrivilegeLogEntries.caseId, caseId),
          eq(casePrivilegeLogEntries.id, orderedIds[i]),
        ),
      );
  }
}
