// src/server/services/motions-in-limine/service.ts
//
// Motions in Limine service layer for ClearTerms 3.2.5 (Trial Prep Wave 5).
// Sets are the parent; MILs are rows. Lifecycle: draft → final → submitted.
// Library copies preserve a `source_template_id` link; if the lawyer edits any
// of the four body sections (introduction, relief_sought, legal_authority,
// conclusion) away from the verbatim library text, `source` auto-flips
// 'library' → 'modified'. Comparison is whitespace-normalized per-section.

import { and, asc, eq, isNull, max, or } from "drizzle-orm";
import {
  caseMotionsInLimineSets,
  type MilSetServingParty,
} from "@/server/db/schema/case-motions-in-limine-sets";
import {
  caseMotionsInLimine,
  type MilSource,
} from "@/server/db/schema/case-motions-in-limine";
import {
  motionInLimineTemplates,
  type MilCategory,
} from "@/server/db/schema/motion-in-limine-templates";

type Db = any;

/**
 * Whitespace-normalized text equality. Used to compare each of the four MIL
 * body sections against the source template. Trim, then collapse any run of
 * whitespace (spaces, tabs, newlines) to a single space.
 */
function textEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

/**
 * All four body sections of a MIL match the template (whitespace-normalized)?
 */
function allSectionsMatch(
  row: {
    introduction: string;
    reliefSought: string;
    legalAuthority: string;
    conclusion: string;
  },
  tpl: {
    introduction: string;
    reliefSought: string;
    legalAuthority: string;
    conclusion: string;
  },
): boolean {
  return (
    textEqual(row.introduction, tpl.introduction) &&
    textEqual(row.reliefSought, tpl.reliefSought) &&
    textEqual(row.legalAuthority, tpl.legalAuthority) &&
    textEqual(row.conclusion, tpl.conclusion)
  );
}

// ── Library queries ──────────────────────────────────────────────────────

export async function listLibraryTemplates(
  db: Db,
  orgId: string | null,
  category?: MilCategory,
): Promise<(typeof motionInLimineTemplates.$inferSelect)[]> {
  const conds = [
    eq(motionInLimineTemplates.isActive, true),
    or(
      isNull(motionInLimineTemplates.orgId),
      orgId ? eq(motionInLimineTemplates.orgId, orgId) : undefined,
    ),
  ].filter(Boolean) as any[];
  if (category) conds.push(eq(motionInLimineTemplates.category, category));
  const rows = await db
    .select()
    .from(motionInLimineTemplates)
    .where(and(...conds))
    .orderBy(asc(motionInLimineTemplates.category), asc(motionInLimineTemplates.title));
  return rows as (typeof motionInLimineTemplates.$inferSelect)[];
}

export async function getTemplate(
  db: Db,
  templateId: string,
): Promise<typeof motionInLimineTemplates.$inferSelect> {
  const [row] = await db
    .select()
    .from(motionInLimineTemplates)
    .where(eq(motionInLimineTemplates.id, templateId))
    .limit(1);
  if (!row) throw new Error("Motion in limine template not found");
  return row;
}

// ── Set queries ──────────────────────────────────────────────────────────

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseMotionsInLimineSets.$inferSelect & { milCount: number })[]> {
  const sets = await db
    .select()
    .from(caseMotionsInLimineSets)
    .where(eq(caseMotionsInLimineSets.caseId, caseId))
    .orderBy(
      asc(caseMotionsInLimineSets.servingParty),
      asc(caseMotionsInLimineSets.setNumber),
    );

  const out: (typeof caseMotionsInLimineSets.$inferSelect & {
    milCount: number;
  })[] = [];
  for (const s of sets as (typeof caseMotionsInLimineSets.$inferSelect)[]) {
    const rows = await db
      .select({ id: caseMotionsInLimine.id })
      .from(caseMotionsInLimine)
      .where(eq(caseMotionsInLimine.setId, s.id));
    out.push({ ...s, milCount: (rows as unknown[]).length });
  }
  return out;
}

export async function getSet(
  db: Db,
  setId: string,
): Promise<{
  set: typeof caseMotionsInLimineSets.$inferSelect;
  mils: (typeof caseMotionsInLimine.$inferSelect)[];
}> {
  const [set] = await db
    .select()
    .from(caseMotionsInLimineSets)
    .where(eq(caseMotionsInLimineSets.id, setId))
    .limit(1);
  if (!set) throw new Error("Motion in limine set not found");
  const mils = await db
    .select()
    .from(caseMotionsInLimine)
    .where(eq(caseMotionsInLimine.setId, setId))
    .orderBy(asc(caseMotionsInLimine.milOrder));
  return {
    set,
    mils: mils as (typeof caseMotionsInLimine.$inferSelect)[],
  };
}

export async function getNextSetNumber(
  db: Db,
  caseId: string,
  servingParty: MilSetServingParty,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseMotionsInLimineSets.setNumber) })
    .from(caseMotionsInLimineSets)
    .where(
      and(
        eq(caseMotionsInLimineSets.caseId, caseId),
        eq(caseMotionsInLimineSets.servingParty, servingParty),
      ),
    );
  return ((row?.maxN ?? 0) as number) + 1;
}

// ── Set mutations ────────────────────────────────────────────────────────

export interface CreateSetInput {
  orgId: string;
  caseId: string;
  servingParty: MilSetServingParty;
  setNumber: number;
  title: string;
  createdBy: string;
}

export async function createSet(
  db: Db,
  input: CreateSetInput,
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(caseMotionsInLimineSets)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      servingParty: input.servingParty,
      setNumber: input.setNumber,
      title: input.title,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: caseMotionsInLimineSets.id });
  return { id: inserted.id };
}

async function getSetRow(
  db: Db,
  setId: string,
): Promise<typeof caseMotionsInLimineSets.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseMotionsInLimineSets)
    .where(eq(caseMotionsInLimineSets.id, setId))
    .limit(1);
  if (!row) throw new Error("Motion in limine set not found");
  return row;
}

async function requireDraft(
  db: Db,
  setId: string,
): Promise<typeof caseMotionsInLimineSets.$inferSelect> {
  const row = await getSetRow(db, setId);
  if (row.status !== "draft") {
    throw new Error("Only draft motion in limine sets can be edited");
  }
  return row;
}

export async function updateSetMeta(
  db: Db,
  setId: string,
  patch: { title?: string },
): Promise<void> {
  await requireDraft(db, setId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  await db
    .update(caseMotionsInLimineSets)
    .set(set)
    .where(eq(caseMotionsInLimineSets.id, setId));
}

export async function finalizeSet(db: Db, setId: string): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status !== "draft") {
    throw new Error("Only draft motion in limine sets can be finalized");
  }
  const rows = await db
    .select({ id: caseMotionsInLimine.id })
    .from(caseMotionsInLimine)
    .where(eq(caseMotionsInLimine.setId, setId));
  if ((rows as unknown[]).length === 0) {
    throw new Error("Cannot finalize a motion in limine set with no MILs");
  }
  await db
    .update(caseMotionsInLimineSets)
    .set({ status: "final", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseMotionsInLimineSets.id, setId));
}

export async function markSubmitted(
  db: Db,
  setId: string,
  submittedAt: Date,
): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status !== "final") {
    throw new Error("Motion in limine set must be finalized before being submitted");
  }
  await db
    .update(caseMotionsInLimineSets)
    .set({ status: "submitted", submittedAt, updatedAt: new Date() })
    .where(eq(caseMotionsInLimineSets.id, setId));
}

export async function deleteSet(db: Db, setId: string): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status === "submitted") {
    throw new Error("Submitted motion in limine sets cannot be deleted");
  }
  await db
    .delete(caseMotionsInLimineSets)
    .where(eq(caseMotionsInLimineSets.id, setId));
}

// ── MIL mutations ────────────────────────────────────────────────────────

export interface AddMilInput {
  category: MilCategory;
  freRule?: string | null;
  title: string;
  introduction: string;
  reliefSought: string;
  legalAuthority: string;
  conclusion: string;
  notes?: string | null;
  // Caller-provided when adding from library (internal); ignored from API.
  source?: MilSource;
  sourceTemplateId?: string | null;
}

export async function addMil(
  db: Db,
  setId: string,
  input: AddMilInput,
): Promise<{ id: string }> {
  await requireDraft(db, setId);
  const [row] = await db
    .select({ maxN: max(caseMotionsInLimine.milOrder) })
    .from(caseMotionsInLimine)
    .where(eq(caseMotionsInLimine.setId, setId));
  const nextOrder = ((row?.maxN ?? 0) as number) + 1;
  const [inserted] = await db
    .insert(caseMotionsInLimine)
    .values({
      setId,
      milOrder: nextOrder,
      category: input.category,
      freRule: input.freRule ?? null,
      title: input.title,
      introduction: input.introduction,
      reliefSought: input.reliefSought,
      legalAuthority: input.legalAuthority,
      conclusion: input.conclusion,
      source: input.source ?? "manual",
      sourceTemplateId: input.sourceTemplateId ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: caseMotionsInLimine.id });
  return { id: inserted.id };
}

export async function addMilFromTemplate(
  db: Db,
  setId: string,
  templateId: string,
): Promise<{ id: string }> {
  await requireDraft(db, setId);
  const tpl = await getTemplate(db, templateId);
  return addMil(db, setId, {
    category: tpl.category,
    freRule: tpl.freRule,
    title: tpl.title,
    introduction: tpl.introduction,
    reliefSought: tpl.reliefSought,
    legalAuthority: tpl.legalAuthority,
    conclusion: tpl.conclusion,
    source: "library",
    sourceTemplateId: tpl.id,
  });
}

async function getMilRow(
  db: Db,
  milId: string,
): Promise<typeof caseMotionsInLimine.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseMotionsInLimine)
    .where(eq(caseMotionsInLimine.id, milId))
    .limit(1);
  if (!row) throw new Error("Motion in limine not found");
  return row;
}

export interface UpdateMilPatch {
  category?: MilCategory;
  freRule?: string | null;
  title?: string;
  introduction?: string;
  reliefSought?: string;
  legalAuthority?: string;
  conclusion?: string;
  notes?: string | null;
}

export async function updateMil(
  db: Db,
  milId: string,
  patch: UpdateMilPatch,
): Promise<void> {
  const row = await getMilRow(db, milId);
  await requireDraft(db, row.setId);

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.freRule !== undefined) update.freRule = patch.freRule;
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.notes !== undefined) update.notes = patch.notes;

  const bodyTouched =
    patch.introduction !== undefined ||
    patch.reliefSought !== undefined ||
    patch.legalAuthority !== undefined ||
    patch.conclusion !== undefined;

  if (patch.introduction !== undefined) update.introduction = patch.introduction;
  if (patch.reliefSought !== undefined) update.reliefSought = patch.reliefSought;
  if (patch.legalAuthority !== undefined) update.legalAuthority = patch.legalAuthority;
  if (patch.conclusion !== undefined) update.conclusion = patch.conclusion;

  // Modify-flip: compare the post-update values for ALL FOUR sections against
  // the source template (whitespace-normalized). If all four match → 'library';
  // if any differs → 'modified'. Manual rows (no sourceTemplateId) untouched.
  if (bodyTouched && row.sourceTemplateId) {
    try {
      const tpl = await getTemplate(db, row.sourceTemplateId);
      const next = {
        introduction: patch.introduction ?? row.introduction,
        reliefSought: patch.reliefSought ?? row.reliefSought,
        legalAuthority: patch.legalAuthority ?? row.legalAuthority,
        conclusion: patch.conclusion ?? row.conclusion,
      };
      update.source = allSectionsMatch(next, tpl) ? "library" : "modified";
    } catch {
      // Template gone (FK SET NULL'd somehow). Best-effort: any change → modified.
      update.source = "modified";
    }
  }

  await db
    .update(caseMotionsInLimine)
    .set(update)
    .where(eq(caseMotionsInLimine.id, milId));
}

export async function deleteMil(db: Db, milId: string): Promise<void> {
  const row = await getMilRow(db, milId);
  await requireDraft(db, row.setId);
  await db
    .delete(caseMotionsInLimine)
    .where(eq(caseMotionsInLimine.id, milId));
}

/**
 * Bulk reorder. Two-pass scratch-and-commit to dodge the unique
 * (set_id, mil_order) constraint. Final orders are 1..N in input order.
 */
export async function reorderMils(
  db: Db,
  setId: string,
  orderedIds: string[],
): Promise<void> {
  await requireDraft(db, setId);
  if (orderedIds.length === 0) return;
  const TEMP_OFFSET = 5000;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseMotionsInLimine)
      .set({ milOrder: TEMP_OFFSET + i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseMotionsInLimine.setId, setId),
          eq(caseMotionsInLimine.id, orderedIds[i]),
        ),
      );
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseMotionsInLimine)
      .set({ milOrder: i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseMotionsInLimine.setId, setId),
          eq(caseMotionsInLimine.id, orderedIds[i]),
        ),
      );
  }
}

// Exposed for tests.
export const __testing = { textEqual, allSectionsMatch };
