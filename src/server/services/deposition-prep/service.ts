// src/server/services/deposition-prep/service.ts
//
// Deposition Outline Prep service layer for ClearTerms 3.1.6.
// Outlines are parents; topics are sections within an outline; questions are
// rows within topics. Lifecycle: draft → finalized (no submission — outlines
// are work product, never filed).
//
// Library copies preserve a `source_template_id` link on the question. If the
// lawyer edits the question text away from the verbatim template text,
// `source` auto-flips 'library' → 'modified' (whitespace-normalized compare,
// matching the jury-instructions/voir-dire pattern).

import { and, asc, eq, isNull, max, or } from "drizzle-orm";
import {
  caseDepositionOutlines,
  type DepositionOutlineServingParty,
} from "@/server/db/schema/case-deposition-outlines";
import {
  caseDepositionTopics,
} from "@/server/db/schema/case-deposition-topics";
import {
  caseDepositionQuestions,
  type DepositionQuestionPriority,
  type DepositionQuestionSource,
} from "@/server/db/schema/case-deposition-questions";
import {
  depositionTopicTemplates,
  type DeponentRole,
  type DepositionTopicCategory,
} from "@/server/db/schema/deposition-topic-templates";

type Db = any;

function bodiesEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

// ── Library queries ──────────────────────────────────────────────────────

export async function listLibraryTemplates(
  db: Db,
  orgId: string | null,
  deponentRole?: DeponentRole,
  category?: DepositionTopicCategory,
): Promise<(typeof depositionTopicTemplates.$inferSelect)[]> {
  const conds = [
    eq(depositionTopicTemplates.isActive, true),
    or(
      isNull(depositionTopicTemplates.orgId),
      orgId ? eq(depositionTopicTemplates.orgId, orgId) : undefined,
    ),
  ].filter(Boolean) as any[];
  if (deponentRole)
    conds.push(eq(depositionTopicTemplates.deponentRole, deponentRole));
  if (category) conds.push(eq(depositionTopicTemplates.category, category));
  const rows = await db
    .select()
    .from(depositionTopicTemplates)
    .where(and(...conds))
    .orderBy(
      asc(depositionTopicTemplates.deponentRole),
      asc(depositionTopicTemplates.category),
      asc(depositionTopicTemplates.title),
    );
  return rows as (typeof depositionTopicTemplates.$inferSelect)[];
}

export async function getTemplate(
  db: Db,
  templateId: string,
): Promise<typeof depositionTopicTemplates.$inferSelect> {
  const [row] = await db
    .select()
    .from(depositionTopicTemplates)
    .where(eq(depositionTopicTemplates.id, templateId))
    .limit(1);
  if (!row) throw new Error("Deposition topic template not found");
  return row;
}

// ── Outline queries ──────────────────────────────────────────────────────

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<
  (typeof caseDepositionOutlines.$inferSelect & {
    topicCount: number;
    questionCount: number;
  })[]
> {
  const outlines = await db
    .select()
    .from(caseDepositionOutlines)
    .where(eq(caseDepositionOutlines.caseId, caseId))
    .orderBy(
      asc(caseDepositionOutlines.deponentName),
      asc(caseDepositionOutlines.outlineNumber),
    );

  const out: (typeof caseDepositionOutlines.$inferSelect & {
    topicCount: number;
    questionCount: number;
  })[] = [];
  for (const o of outlines as (typeof caseDepositionOutlines.$inferSelect)[]) {
    const topics = await db
      .select({ id: caseDepositionTopics.id })
      .from(caseDepositionTopics)
      .where(eq(caseDepositionTopics.outlineId, o.id));
    const topicIds = (topics as { id: string }[]).map((t) => t.id);
    let questionCount = 0;
    for (const tid of topicIds) {
      const qs = await db
        .select({ id: caseDepositionQuestions.id })
        .from(caseDepositionQuestions)
        .where(eq(caseDepositionQuestions.topicId, tid));
      questionCount += (qs as unknown[]).length;
    }
    out.push({
      ...o,
      topicCount: topicIds.length,
      questionCount,
    });
  }
  return out;
}

export async function getOutline(
  db: Db,
  outlineId: string,
): Promise<{
  outline: typeof caseDepositionOutlines.$inferSelect;
  topics: (typeof caseDepositionTopics.$inferSelect & {
    questions: (typeof caseDepositionQuestions.$inferSelect)[];
  })[];
}> {
  const [outline] = await db
    .select()
    .from(caseDepositionOutlines)
    .where(eq(caseDepositionOutlines.id, outlineId))
    .limit(1);
  if (!outline) throw new Error("Deposition outline not found");
  const topics = await db
    .select()
    .from(caseDepositionTopics)
    .where(eq(caseDepositionTopics.outlineId, outlineId))
    .orderBy(asc(caseDepositionTopics.topicOrder));
  const out: (typeof caseDepositionTopics.$inferSelect & {
    questions: (typeof caseDepositionQuestions.$inferSelect)[];
  })[] = [];
  for (const t of topics as (typeof caseDepositionTopics.$inferSelect)[]) {
    const qs = await db
      .select()
      .from(caseDepositionQuestions)
      .where(eq(caseDepositionQuestions.topicId, t.id))
      .orderBy(asc(caseDepositionQuestions.questionOrder));
    out.push({
      ...t,
      questions: qs as (typeof caseDepositionQuestions.$inferSelect)[],
    });
  }
  return { outline, topics: out };
}

export async function getNextOutlineNumber(
  db: Db,
  caseId: string,
  deponentName: string,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseDepositionOutlines.outlineNumber) })
    .from(caseDepositionOutlines)
    .where(
      and(
        eq(caseDepositionOutlines.caseId, caseId),
        eq(caseDepositionOutlines.deponentName, deponentName),
      ),
    );
  return ((row?.maxN ?? 0) as number) + 1;
}

// ── Outline mutations ────────────────────────────────────────────────────

export interface CreateOutlineInput {
  orgId: string;
  caseId: string;
  servingParty: DepositionOutlineServingParty;
  deponentName: string;
  deponentRole: DeponentRole;
  outlineNumber: number;
  title: string;
  scheduledDate?: string | null;
  location?: string | null;
  createdBy: string;
}

export async function createOutline(
  db: Db,
  input: CreateOutlineInput,
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(caseDepositionOutlines)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      servingParty: input.servingParty,
      deponentName: input.deponentName,
      deponentRole: input.deponentRole,
      outlineNumber: input.outlineNumber,
      title: input.title,
      scheduledDate: input.scheduledDate ?? null,
      location: input.location ?? null,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: caseDepositionOutlines.id });
  return { id: inserted.id };
}

async function getOutlineRow(
  db: Db,
  outlineId: string,
): Promise<typeof caseDepositionOutlines.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseDepositionOutlines)
    .where(eq(caseDepositionOutlines.id, outlineId))
    .limit(1);
  if (!row) throw new Error("Deposition outline not found");
  return row;
}

async function requireDraft(
  db: Db,
  outlineId: string,
): Promise<typeof caseDepositionOutlines.$inferSelect> {
  const row = await getOutlineRow(db, outlineId);
  if (row.status !== "draft") {
    throw new Error("Only draft deposition outlines can be edited");
  }
  return row;
}

export async function updateOutlineMeta(
  db: Db,
  outlineId: string,
  patch: {
    title?: string;
    scheduledDate?: string | null;
    location?: string | null;
    deponentName?: string;
    deponentRole?: DeponentRole;
    servingParty?: DepositionOutlineServingParty;
  },
): Promise<void> {
  await requireDraft(db, outlineId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.scheduledDate !== undefined) set.scheduledDate = patch.scheduledDate;
  if (patch.location !== undefined) set.location = patch.location;
  if (patch.deponentName !== undefined) set.deponentName = patch.deponentName;
  if (patch.deponentRole !== undefined) set.deponentRole = patch.deponentRole;
  if (patch.servingParty !== undefined) set.servingParty = patch.servingParty;
  await db
    .update(caseDepositionOutlines)
    .set(set)
    .where(eq(caseDepositionOutlines.id, outlineId));
}

export async function finalizeOutline(db: Db, outlineId: string): Promise<void> {
  const row = await getOutlineRow(db, outlineId);
  if (row.status !== "draft") {
    throw new Error("Only draft deposition outlines can be finalized");
  }
  const topics = await db
    .select({ id: caseDepositionTopics.id })
    .from(caseDepositionTopics)
    .where(eq(caseDepositionTopics.outlineId, outlineId));
  const topicIds = (topics as { id: string }[]).map((t) => t.id);
  if (topicIds.length === 0) {
    throw new Error("Cannot finalize a deposition outline with no topics");
  }
  let totalQuestions = 0;
  for (const tid of topicIds) {
    const qs = await db
      .select({ id: caseDepositionQuestions.id })
      .from(caseDepositionQuestions)
      .where(eq(caseDepositionQuestions.topicId, tid));
    totalQuestions += (qs as unknown[]).length;
  }
  if (totalQuestions === 0) {
    throw new Error("Cannot finalize a deposition outline with no questions");
  }
  await db
    .update(caseDepositionOutlines)
    .set({ status: "finalized", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseDepositionOutlines.id, outlineId));
}

export async function deleteOutline(db: Db, outlineId: string): Promise<void> {
  await getOutlineRow(db, outlineId);
  await db
    .delete(caseDepositionOutlines)
    .where(eq(caseDepositionOutlines.id, outlineId));
}

// ── Topic mutations ──────────────────────────────────────────────────────

export interface AddTopicInput {
  category: DepositionTopicCategory;
  title: string;
  notes?: string | null;
}

export async function addTopic(
  db: Db,
  outlineId: string,
  input: AddTopicInput,
): Promise<{ id: string }> {
  await requireDraft(db, outlineId);
  const [row] = await db
    .select({ maxN: max(caseDepositionTopics.topicOrder) })
    .from(caseDepositionTopics)
    .where(eq(caseDepositionTopics.outlineId, outlineId));
  const nextOrder = ((row?.maxN ?? 0) as number) + 1;
  const [inserted] = await db
    .insert(caseDepositionTopics)
    .values({
      outlineId,
      topicOrder: nextOrder,
      category: input.category,
      title: input.title,
      notes: input.notes ?? null,
    })
    .returning({ id: caseDepositionTopics.id });
  return { id: inserted.id };
}

export async function addTopicFromTemplate(
  db: Db,
  outlineId: string,
  templateId: string,
): Promise<{ id: string; questionIds: string[] }> {
  await requireDraft(db, outlineId);
  const tpl = await getTemplate(db, templateId);
  const { id: topicId } = await addTopic(db, outlineId, {
    category: tpl.category,
    title: tpl.title,
  });
  const questionIds: string[] = [];
  let order = 1;
  for (const text of tpl.questions) {
    const [inserted] = await db
      .insert(caseDepositionQuestions)
      .values({
        topicId,
        questionOrder: order,
        text,
        source: "library",
        sourceTemplateId: tpl.id,
        priority: "important",
        exhibitRefs: [],
      })
      .returning({ id: caseDepositionQuestions.id });
    questionIds.push(inserted.id);
    order++;
  }
  return { id: topicId, questionIds };
}

async function getTopicRow(
  db: Db,
  topicId: string,
): Promise<typeof caseDepositionTopics.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseDepositionTopics)
    .where(eq(caseDepositionTopics.id, topicId))
    .limit(1);
  if (!row) throw new Error("Deposition topic not found");
  return row;
}

export async function updateTopic(
  db: Db,
  topicId: string,
  patch: {
    category?: DepositionTopicCategory;
    title?: string;
    notes?: string | null;
  },
): Promise<void> {
  const row = await getTopicRow(db, topicId);
  await requireDraft(db, row.outlineId);
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.notes !== undefined) update.notes = patch.notes;
  await db
    .update(caseDepositionTopics)
    .set(update)
    .where(eq(caseDepositionTopics.id, topicId));
}

export async function deleteTopic(db: Db, topicId: string): Promise<void> {
  const row = await getTopicRow(db, topicId);
  await requireDraft(db, row.outlineId);
  await db.delete(caseDepositionTopics).where(eq(caseDepositionTopics.id, topicId));
}

export async function reorderTopics(
  db: Db,
  outlineId: string,
  orderedIds: string[],
): Promise<void> {
  await requireDraft(db, outlineId);
  if (orderedIds.length === 0) return;
  const TEMP_OFFSET = 5000;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseDepositionTopics)
      .set({ topicOrder: TEMP_OFFSET + i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseDepositionTopics.outlineId, outlineId),
          eq(caseDepositionTopics.id, orderedIds[i]),
        ),
      );
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseDepositionTopics)
      .set({ topicOrder: i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseDepositionTopics.outlineId, outlineId),
          eq(caseDepositionTopics.id, orderedIds[i]),
        ),
      );
  }
}

// ── Question mutations ───────────────────────────────────────────────────

export interface AddQuestionInput {
  text: string;
  expectedAnswer?: string | null;
  notes?: string | null;
  exhibitRefs?: string[];
  priority?: DepositionQuestionPriority;
  source?: DepositionQuestionSource;
  sourceTemplateId?: string | null;
}

export async function addQuestion(
  db: Db,
  topicId: string,
  input: AddQuestionInput,
): Promise<{ id: string }> {
  const topic = await getTopicRow(db, topicId);
  await requireDraft(db, topic.outlineId);
  const [row] = await db
    .select({ maxN: max(caseDepositionQuestions.questionOrder) })
    .from(caseDepositionQuestions)
    .where(eq(caseDepositionQuestions.topicId, topicId));
  const nextOrder = ((row?.maxN ?? 0) as number) + 1;
  const [inserted] = await db
    .insert(caseDepositionQuestions)
    .values({
      topicId,
      questionOrder: nextOrder,
      text: input.text,
      expectedAnswer: input.expectedAnswer ?? null,
      notes: input.notes ?? null,
      source: input.source ?? "manual",
      sourceTemplateId: input.sourceTemplateId ?? null,
      exhibitRefs: input.exhibitRefs ?? [],
      priority: input.priority ?? "important",
    })
    .returning({ id: caseDepositionQuestions.id });
  return { id: inserted.id };
}

async function getQuestionRow(
  db: Db,
  questionId: string,
): Promise<typeof caseDepositionQuestions.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseDepositionQuestions)
    .where(eq(caseDepositionQuestions.id, questionId))
    .limit(1);
  if (!row) throw new Error("Deposition question not found");
  return row;
}

export interface UpdateQuestionPatch {
  text?: string;
  expectedAnswer?: string | null;
  notes?: string | null;
  exhibitRefs?: string[];
  priority?: DepositionQuestionPriority;
}

export async function updateQuestion(
  db: Db,
  questionId: string,
  patch: UpdateQuestionPatch,
): Promise<void> {
  const row = await getQuestionRow(db, questionId);
  // requireDraft via the topic's outline
  const topic = await getTopicRow(db, row.topicId);
  await requireDraft(db, topic.outlineId);

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.expectedAnswer !== undefined)
    update.expectedAnswer = patch.expectedAnswer;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.exhibitRefs !== undefined) update.exhibitRefs = patch.exhibitRefs;
  if (patch.priority !== undefined) update.priority = patch.priority;

  if (patch.text !== undefined) {
    update.text = patch.text;
    // Modify-flip: library → modified when text changes substantively from
    // the source template's verbatim question. Reverting back restores the
    // 'library' badge.
    if (
      (row.source === "library" || row.source === "modified") &&
      row.sourceTemplateId
    ) {
      try {
        const tpl = await getTemplate(db, row.sourceTemplateId);
        // Find the verbatim question in the template by matching against any
        // entry that originally produced this row. We don't know which index
        // the row came from, so consider it 'library' only if the new text
        // matches ANY of the template's questions verbatim (whitespace-norm).
        const matchesAny = tpl.questions.some((q: string) =>
          bodiesEqual(q, patch.text!),
        );
        update.source = matchesAny ? "library" : "modified";
      } catch {
        update.source = "modified";
      }
    }
  }

  await db
    .update(caseDepositionQuestions)
    .set(update)
    .where(eq(caseDepositionQuestions.id, questionId));
}

export async function deleteQuestion(db: Db, questionId: string): Promise<void> {
  const row = await getQuestionRow(db, questionId);
  const topic = await getTopicRow(db, row.topicId);
  await requireDraft(db, topic.outlineId);
  await db
    .delete(caseDepositionQuestions)
    .where(eq(caseDepositionQuestions.id, questionId));
}

export async function reorderQuestions(
  db: Db,
  topicId: string,
  orderedIds: string[],
): Promise<void> {
  const topic = await getTopicRow(db, topicId);
  await requireDraft(db, topic.outlineId);
  if (orderedIds.length === 0) return;
  const TEMP_OFFSET = 5000;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseDepositionQuestions)
      .set({ questionOrder: TEMP_OFFSET + i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseDepositionQuestions.topicId, topicId),
          eq(caseDepositionQuestions.id, orderedIds[i]),
        ),
      );
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseDepositionQuestions)
      .set({ questionOrder: i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseDepositionQuestions.topicId, topicId),
          eq(caseDepositionQuestions.id, orderedIds[i]),
        ),
      );
  }
}

// Exposed for tests.
export const __testing = { bodiesEqual };
