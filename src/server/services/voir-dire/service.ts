// src/server/services/voir-dire/service.ts
//
// Voir Dire Questions service layer for ClearTerms 3.2.4 (Trial Prep Wave 4).
// Sets are the parent; questions are rows. Lifecycle: draft → final → submitted.
// Library copies preserve a `source_template_id` link; if the lawyer edits the
// text away from the verbatim library text, `source` auto-flips
// 'library' → 'modified'. Comparison is whitespace-normalized: leading/trailing
// whitespace trimmed and any run of internal whitespace (incl. newlines)
// collapsed to a single space.

import { and, asc, eq, isNull, max, or } from "drizzle-orm";
import {
  caseVoirDireSets,
  type VoirDireSetServingParty,
} from "@/server/db/schema/case-voir-dire-sets";
import {
  caseVoirDireQuestions,
  type VoirDireQuestionCategory,
  type VoirDirePanelTarget,
  type VoirDireSource,
} from "@/server/db/schema/case-voir-dire-questions";
import { voirDireQuestionTemplates } from "@/server/db/schema/voir-dire-question-templates";

type Db = any;

/**
 * Whitespace-normalized text equality. Used to decide whether an edit to a
 * library-derived question has actually changed the text.
 */
function bodiesEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

// ── Library queries ──────────────────────────────────────────────────────

export async function listLibraryTemplates(
  db: Db,
  orgId: string | null,
  category?: VoirDireQuestionCategory,
  caseType?: string,
): Promise<(typeof voirDireQuestionTemplates.$inferSelect)[]> {
  const conds = [
    eq(voirDireQuestionTemplates.isActive, true),
    or(
      isNull(voirDireQuestionTemplates.orgId),
      orgId ? eq(voirDireQuestionTemplates.orgId, orgId) : undefined,
    ),
  ].filter(Boolean) as any[];
  if (category) conds.push(eq(voirDireQuestionTemplates.category, category));
  if (caseType) {
    conds.push(
      or(
        isNull(voirDireQuestionTemplates.caseType),
        eq(voirDireQuestionTemplates.caseType, caseType),
      ),
    );
  }
  const rows = await db
    .select()
    .from(voirDireQuestionTemplates)
    .where(and(...conds))
    .orderBy(
      asc(voirDireQuestionTemplates.category),
      asc(voirDireQuestionTemplates.createdAt),
    );
  return rows as (typeof voirDireQuestionTemplates.$inferSelect)[];
}

export async function getTemplate(
  db: Db,
  templateId: string,
): Promise<typeof voirDireQuestionTemplates.$inferSelect> {
  const [row] = await db
    .select()
    .from(voirDireQuestionTemplates)
    .where(eq(voirDireQuestionTemplates.id, templateId))
    .limit(1);
  if (!row) throw new Error("Voir dire question template not found");
  return row;
}

// ── Set queries ──────────────────────────────────────────────────────────

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseVoirDireSets.$inferSelect & { questionCount: number })[]> {
  const sets = await db
    .select()
    .from(caseVoirDireSets)
    .where(eq(caseVoirDireSets.caseId, caseId))
    .orderBy(
      asc(caseVoirDireSets.servingParty),
      asc(caseVoirDireSets.setNumber),
    );

  const out: (typeof caseVoirDireSets.$inferSelect & {
    questionCount: number;
  })[] = [];
  for (const s of sets as (typeof caseVoirDireSets.$inferSelect)[]) {
    const rows = await db
      .select({ id: caseVoirDireQuestions.id })
      .from(caseVoirDireQuestions)
      .where(eq(caseVoirDireQuestions.setId, s.id));
    out.push({ ...s, questionCount: (rows as unknown[]).length });
  }
  return out;
}

export async function getSet(
  db: Db,
  setId: string,
): Promise<{
  set: typeof caseVoirDireSets.$inferSelect;
  questions: (typeof caseVoirDireQuestions.$inferSelect)[];
}> {
  const [set] = await db
    .select()
    .from(caseVoirDireSets)
    .where(eq(caseVoirDireSets.id, setId))
    .limit(1);
  if (!set) throw new Error("Voir dire set not found");
  const questions = await db
    .select()
    .from(caseVoirDireQuestions)
    .where(eq(caseVoirDireQuestions.setId, setId))
    .orderBy(asc(caseVoirDireQuestions.questionOrder));
  return {
    set,
    questions: questions as (typeof caseVoirDireQuestions.$inferSelect)[],
  };
}

export async function getNextSetNumber(
  db: Db,
  caseId: string,
  servingParty: VoirDireSetServingParty,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseVoirDireSets.setNumber) })
    .from(caseVoirDireSets)
    .where(
      and(
        eq(caseVoirDireSets.caseId, caseId),
        eq(caseVoirDireSets.servingParty, servingParty),
      ),
    );
  return ((row?.maxN ?? 0) as number) + 1;
}

// ── Set mutations ────────────────────────────────────────────────────────

export interface CreateSetInput {
  orgId: string;
  caseId: string;
  servingParty: VoirDireSetServingParty;
  setNumber: number;
  title: string;
  createdBy: string;
}

export async function createSet(
  db: Db,
  input: CreateSetInput,
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(caseVoirDireSets)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      servingParty: input.servingParty,
      setNumber: input.setNumber,
      title: input.title,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: caseVoirDireSets.id });
  return { id: inserted.id };
}

async function getSetRow(
  db: Db,
  setId: string,
): Promise<typeof caseVoirDireSets.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseVoirDireSets)
    .where(eq(caseVoirDireSets.id, setId))
    .limit(1);
  if (!row) throw new Error("Voir dire set not found");
  return row;
}

async function requireDraft(
  db: Db,
  setId: string,
): Promise<typeof caseVoirDireSets.$inferSelect> {
  const row = await getSetRow(db, setId);
  if (row.status !== "draft") {
    throw new Error("Only draft voir dire sets can be edited");
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
    .update(caseVoirDireSets)
    .set(set)
    .where(eq(caseVoirDireSets.id, setId));
}

export async function finalizeSet(db: Db, setId: string): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status !== "draft") {
    throw new Error("Only draft voir dire sets can be finalized");
  }
  const rows = await db
    .select({ id: caseVoirDireQuestions.id })
    .from(caseVoirDireQuestions)
    .where(eq(caseVoirDireQuestions.setId, setId));
  if ((rows as unknown[]).length === 0) {
    throw new Error("Cannot finalize a voir dire set with no questions");
  }
  await db
    .update(caseVoirDireSets)
    .set({ status: "final", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseVoirDireSets.id, setId));
}

export async function markSubmitted(
  db: Db,
  setId: string,
  submittedAt: Date,
): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status !== "final") {
    throw new Error("Voir dire set must be finalized before being submitted");
  }
  await db
    .update(caseVoirDireSets)
    .set({ status: "submitted", submittedAt, updatedAt: new Date() })
    .where(eq(caseVoirDireSets.id, setId));
}

export async function deleteSet(db: Db, setId: string): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status === "submitted") {
    throw new Error("Submitted voir dire sets cannot be deleted");
  }
  await db
    .delete(caseVoirDireSets)
    .where(eq(caseVoirDireSets.id, setId));
}

// ── Question mutations ───────────────────────────────────────────────────

export interface AddQuestionInput {
  category: VoirDireQuestionCategory;
  text: string;
  followUpPrompt?: string | null;
  isForCause?: boolean;
  jurorPanelTarget?: VoirDirePanelTarget;
  notes?: string | null;
  // Caller-provided when adding from library (internal); ignored from API.
  source?: VoirDireSource;
  sourceTemplateId?: string | null;
}

export async function addQuestion(
  db: Db,
  setId: string,
  input: AddQuestionInput,
): Promise<{ id: string }> {
  await requireDraft(db, setId);
  const [row] = await db
    .select({ maxN: max(caseVoirDireQuestions.questionOrder) })
    .from(caseVoirDireQuestions)
    .where(eq(caseVoirDireQuestions.setId, setId));
  const nextOrder = ((row?.maxN ?? 0) as number) + 1;
  const [inserted] = await db
    .insert(caseVoirDireQuestions)
    .values({
      setId,
      questionOrder: nextOrder,
      category: input.category,
      text: input.text,
      followUpPrompt: input.followUpPrompt ?? null,
      isForCause: input.isForCause ?? false,
      jurorPanelTarget: input.jurorPanelTarget ?? "all",
      source: input.source ?? "manual",
      sourceTemplateId: input.sourceTemplateId ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: caseVoirDireQuestions.id });
  return { id: inserted.id };
}

export async function addQuestionFromTemplate(
  db: Db,
  setId: string,
  templateId: string,
): Promise<{ id: string }> {
  await requireDraft(db, setId);
  const tpl = await getTemplate(db, templateId);
  return addQuestion(db, setId, {
    category: tpl.category,
    text: tpl.text,
    followUpPrompt: tpl.followUpPrompt,
    isForCause: tpl.isForCause,
    source: "library",
    sourceTemplateId: tpl.id,
  });
}

async function getQuestionRow(
  db: Db,
  questionId: string,
): Promise<typeof caseVoirDireQuestions.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseVoirDireQuestions)
    .where(eq(caseVoirDireQuestions.id, questionId))
    .limit(1);
  if (!row) throw new Error("Voir dire question not found");
  return row;
}

export interface UpdateQuestionPatch {
  category?: VoirDireQuestionCategory;
  text?: string;
  followUpPrompt?: string | null;
  isForCause?: boolean;
  jurorPanelTarget?: VoirDirePanelTarget;
  notes?: string | null;
}

export async function updateQuestion(
  db: Db,
  questionId: string,
  patch: UpdateQuestionPatch,
): Promise<void> {
  const row = await getQuestionRow(db, questionId);
  await requireDraft(db, row.setId);
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.followUpPrompt !== undefined) update.followUpPrompt = patch.followUpPrompt;
  if (patch.isForCause !== undefined) update.isForCause = patch.isForCause;
  if (patch.jurorPanelTarget !== undefined) update.jurorPanelTarget = patch.jurorPanelTarget;
  if (patch.notes !== undefined) update.notes = patch.notes;

  if (patch.text !== undefined) {
    update.text = patch.text;
    if (row.source === "library" && row.sourceTemplateId) {
      try {
        const tpl = await getTemplate(db, row.sourceTemplateId);
        update.source = bodiesEqual(patch.text, tpl.text) ? "library" : "modified";
      } catch {
        update.source = "modified";
      }
    } else if (row.source === "modified" && row.sourceTemplateId) {
      try {
        const tpl = await getTemplate(db, row.sourceTemplateId);
        if (bodiesEqual(patch.text, tpl.text)) update.source = "library";
      } catch {
        // ignore
      }
    }
  }

  await db
    .update(caseVoirDireQuestions)
    .set(update)
    .where(eq(caseVoirDireQuestions.id, questionId));
}

export async function deleteQuestion(
  db: Db,
  questionId: string,
): Promise<void> {
  const row = await getQuestionRow(db, questionId);
  await requireDraft(db, row.setId);
  await db
    .delete(caseVoirDireQuestions)
    .where(eq(caseVoirDireQuestions.id, questionId));
}

/**
 * Bulk reorder. Two-pass scratch-and-commit to dodge the unique
 * (set_id, question_order) constraint. Final orders are 1..N in input order.
 */
export async function reorderQuestions(
  db: Db,
  setId: string,
  orderedIds: string[],
): Promise<void> {
  await requireDraft(db, setId);
  if (orderedIds.length === 0) return;
  const TEMP_OFFSET = 5000;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseVoirDireQuestions)
      .set({ questionOrder: TEMP_OFFSET + i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseVoirDireQuestions.setId, setId),
          eq(caseVoirDireQuestions.id, orderedIds[i]),
        ),
      );
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseVoirDireQuestions)
      .set({ questionOrder: i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseVoirDireQuestions.setId, setId),
          eq(caseVoirDireQuestions.id, orderedIds[i]),
        ),
      );
  }
}

// Exposed for tests.
export const __testing = { bodiesEqual };
