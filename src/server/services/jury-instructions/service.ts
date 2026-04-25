// src/server/services/jury-instructions/service.ts
//
// Proposed Jury Instructions service layer for ClearTerms 3.2.3 (Trial Prep Wave 3).
// Sets are the parent; instructions are rows. Lifecycle: draft → final → submitted.
// Library copies preserve a `source_template_id` link; if the lawyer edits the
// body away from the verbatim library text, `source` auto-flips
// 'library' → 'modified'. Comparison is whitespace-normalized: leading/trailing
// whitespace trimmed and any run of internal whitespace (incl. newlines)
// collapsed to a single space — so paragraph reformatting alone does not flip
// the badge, but any substantive word change does.

import { and, asc, eq, isNull, max, or } from "drizzle-orm";
import {
  caseJuryInstructionSets,
  type JuryInstructionSetServingParty,
} from "@/server/db/schema/case-jury-instruction-sets";
import {
  caseJuryInstructions,
  type JuryInstructionCategory,
  type JuryInstructionPartyPosition,
  type JuryInstructionSource,
} from "@/server/db/schema/case-jury-instructions";
import { juryInstructionTemplates } from "@/server/db/schema/jury-instruction-templates";

type Db = any;

/**
 * Whitespace-normalized body equality. Used to decide whether an edit to a
 * library-derived instruction has actually changed the text. Trim, collapse
 * any run of whitespace (spaces, tabs, newlines) to a single space.
 */
function bodiesEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

function defaultPartyPosition(
  party: JuryInstructionSetServingParty,
): JuryInstructionPartyPosition {
  return party === "plaintiff" ? "plaintiff_proposed" : "defendant_proposed";
}

// ── Library queries ──────────────────────────────────────────────────────

export async function listLibraryTemplates(
  db: Db,
  orgId: string | null,
  category?: JuryInstructionCategory,
): Promise<(typeof juryInstructionTemplates.$inferSelect)[]> {
  // Return global templates (org_id IS NULL) + this org's customizations.
  const conds = [
    eq(juryInstructionTemplates.isActive, true),
    or(
      isNull(juryInstructionTemplates.orgId),
      orgId ? eq(juryInstructionTemplates.orgId, orgId) : undefined,
    ),
  ].filter(Boolean) as any[];
  if (category) conds.push(eq(juryInstructionTemplates.category, category));
  const rows = await db
    .select()
    .from(juryInstructionTemplates)
    .where(and(...conds))
    .orderBy(
      asc(juryInstructionTemplates.category),
      asc(juryInstructionTemplates.instructionNumber),
    );
  return rows as (typeof juryInstructionTemplates.$inferSelect)[];
}

export async function getTemplate(
  db: Db,
  templateId: string,
): Promise<typeof juryInstructionTemplates.$inferSelect> {
  const [row] = await db
    .select()
    .from(juryInstructionTemplates)
    .where(eq(juryInstructionTemplates.id, templateId))
    .limit(1);
  if (!row) throw new Error("Jury instruction template not found");
  return row;
}

// ── Set queries ──────────────────────────────────────────────────────────

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseJuryInstructionSets.$inferSelect & { instructionCount: number })[]> {
  const sets = await db
    .select()
    .from(caseJuryInstructionSets)
    .where(eq(caseJuryInstructionSets.caseId, caseId))
    .orderBy(
      asc(caseJuryInstructionSets.servingParty),
      asc(caseJuryInstructionSets.setNumber),
    );

  const out: (typeof caseJuryInstructionSets.$inferSelect & {
    instructionCount: number;
  })[] = [];
  for (const s of sets as (typeof caseJuryInstructionSets.$inferSelect)[]) {
    const rows = await db
      .select({ id: caseJuryInstructions.id })
      .from(caseJuryInstructions)
      .where(eq(caseJuryInstructions.setId, s.id));
    out.push({ ...s, instructionCount: (rows as unknown[]).length });
  }
  return out;
}

export async function getSet(
  db: Db,
  setId: string,
): Promise<{
  set: typeof caseJuryInstructionSets.$inferSelect;
  instructions: (typeof caseJuryInstructions.$inferSelect)[];
}> {
  const [set] = await db
    .select()
    .from(caseJuryInstructionSets)
    .where(eq(caseJuryInstructionSets.id, setId))
    .limit(1);
  if (!set) throw new Error("Jury instruction set not found");
  const instructions = await db
    .select()
    .from(caseJuryInstructions)
    .where(eq(caseJuryInstructions.setId, setId))
    .orderBy(asc(caseJuryInstructions.instructionOrder));
  return {
    set,
    instructions: instructions as (typeof caseJuryInstructions.$inferSelect)[],
  };
}

export async function getNextSetNumber(
  db: Db,
  caseId: string,
  servingParty: JuryInstructionSetServingParty,
): Promise<number> {
  const [row] = await db
    .select({ maxN: max(caseJuryInstructionSets.setNumber) })
    .from(caseJuryInstructionSets)
    .where(
      and(
        eq(caseJuryInstructionSets.caseId, caseId),
        eq(caseJuryInstructionSets.servingParty, servingParty),
      ),
    );
  return ((row?.maxN ?? 0) as number) + 1;
}

// ── Set mutations ────────────────────────────────────────────────────────

export interface CreateSetInput {
  orgId: string;
  caseId: string;
  servingParty: JuryInstructionSetServingParty;
  setNumber: number;
  title: string;
  createdBy: string;
}

export async function createSet(
  db: Db,
  input: CreateSetInput,
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(caseJuryInstructionSets)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      servingParty: input.servingParty,
      setNumber: input.setNumber,
      title: input.title,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: caseJuryInstructionSets.id });
  return { id: inserted.id };
}

async function getSetRow(
  db: Db,
  setId: string,
): Promise<typeof caseJuryInstructionSets.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseJuryInstructionSets)
    .where(eq(caseJuryInstructionSets.id, setId))
    .limit(1);
  if (!row) throw new Error("Jury instruction set not found");
  return row;
}

async function requireDraft(
  db: Db,
  setId: string,
): Promise<typeof caseJuryInstructionSets.$inferSelect> {
  const row = await getSetRow(db, setId);
  if (row.status !== "draft") {
    throw new Error("Only draft jury instruction sets can be edited");
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
    .update(caseJuryInstructionSets)
    .set(set)
    .where(eq(caseJuryInstructionSets.id, setId));
}

export async function finalizeSet(db: Db, setId: string): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status !== "draft") {
    throw new Error("Only draft jury instruction sets can be finalized");
  }
  const rows = await db
    .select({ id: caseJuryInstructions.id })
    .from(caseJuryInstructions)
    .where(eq(caseJuryInstructions.setId, setId));
  if ((rows as unknown[]).length === 0) {
    throw new Error("Cannot finalize a jury instruction set with no instructions");
  }
  await db
    .update(caseJuryInstructionSets)
    .set({ status: "final", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseJuryInstructionSets.id, setId));
}

export async function markSubmitted(
  db: Db,
  setId: string,
  submittedAt: Date,
): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status !== "final") {
    throw new Error("Jury instruction set must be finalized before being submitted");
  }
  await db
    .update(caseJuryInstructionSets)
    .set({ status: "submitted", submittedAt, updatedAt: new Date() })
    .where(eq(caseJuryInstructionSets.id, setId));
}

export async function deleteSet(db: Db, setId: string): Promise<void> {
  const row = await getSetRow(db, setId);
  if (row.status === "submitted") {
    throw new Error("Submitted jury instruction sets cannot be deleted");
  }
  await db
    .delete(caseJuryInstructionSets)
    .where(eq(caseJuryInstructionSets.id, setId));
}

// ── Instruction mutations ────────────────────────────────────────────────

export interface AddInstructionInput {
  category: JuryInstructionCategory;
  instructionNumber: string;
  title: string;
  body: string;
  partyPosition?: JuryInstructionPartyPosition;
  notes?: string | null;
  // Caller-provided when adding from library (internal); ignored from API.
  source?: JuryInstructionSource;
  sourceTemplateId?: string | null;
}

export async function addInstruction(
  db: Db,
  setId: string,
  input: AddInstructionInput,
): Promise<{ id: string }> {
  const set = await requireDraft(db, setId);
  const [row] = await db
    .select({ maxN: max(caseJuryInstructions.instructionOrder) })
    .from(caseJuryInstructions)
    .where(eq(caseJuryInstructions.setId, setId));
  const nextOrder = ((row?.maxN ?? 0) as number) + 1;
  const [inserted] = await db
    .insert(caseJuryInstructions)
    .values({
      setId,
      instructionOrder: nextOrder,
      category: input.category,
      instructionNumber: input.instructionNumber,
      title: input.title,
      body: input.body,
      source: input.source ?? "manual",
      sourceTemplateId: input.sourceTemplateId ?? null,
      partyPosition: input.partyPosition ?? defaultPartyPosition(set.servingParty),
      notes: input.notes ?? null,
    })
    .returning({ id: caseJuryInstructions.id });
  return { id: inserted.id };
}

export async function addInstructionFromTemplate(
  db: Db,
  setId: string,
  templateId: string,
): Promise<{ id: string }> {
  await requireDraft(db, setId);
  const tpl = await getTemplate(db, templateId);
  return addInstruction(db, setId, {
    category: tpl.category,
    instructionNumber: tpl.instructionNumber,
    title: tpl.title,
    body: tpl.body,
    source: "library",
    sourceTemplateId: tpl.id,
  });
}

async function getInstructionRow(
  db: Db,
  instructionId: string,
): Promise<typeof caseJuryInstructions.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseJuryInstructions)
    .where(eq(caseJuryInstructions.id, instructionId))
    .limit(1);
  if (!row) throw new Error("Jury instruction not found");
  return row;
}

export interface UpdateInstructionPatch {
  category?: JuryInstructionCategory;
  instructionNumber?: string;
  title?: string;
  body?: string;
  partyPosition?: JuryInstructionPartyPosition;
  notes?: string | null;
}

export async function updateInstruction(
  db: Db,
  instructionId: string,
  patch: UpdateInstructionPatch,
): Promise<void> {
  const row = await getInstructionRow(db, instructionId);
  await requireDraft(db, row.setId);
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.instructionNumber !== undefined) update.instructionNumber = patch.instructionNumber;
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.partyPosition !== undefined) update.partyPosition = patch.partyPosition;
  if (patch.notes !== undefined) update.notes = patch.notes;

  if (patch.body !== undefined) {
    update.body = patch.body;
    // If this row was sourced from the library and the body actually changed
    // from the template's verbatim text, flip source → 'modified'. Compare
    // against the template (source of truth), not the row's own previous body,
    // so reverting back to the template restores the 'library' badge.
    if (row.source === "library" && row.sourceTemplateId) {
      try {
        const tpl = await getTemplate(db, row.sourceTemplateId);
        update.source = bodiesEqual(patch.body, tpl.body) ? "library" : "modified";
      } catch {
        // Template gone (FK SET NULL'd somehow). Best-effort: any change → modified.
        update.source = "modified";
      }
    } else if (row.source === "modified" && row.sourceTemplateId) {
      // Allow flipping back to 'library' if the lawyer reverts the edit.
      try {
        const tpl = await getTemplate(db, row.sourceTemplateId);
        if (bodiesEqual(patch.body, tpl.body)) update.source = "library";
      } catch {
        // ignore
      }
    }
  }

  await db
    .update(caseJuryInstructions)
    .set(update)
    .where(eq(caseJuryInstructions.id, instructionId));
}

export async function deleteInstruction(
  db: Db,
  instructionId: string,
): Promise<void> {
  const row = await getInstructionRow(db, instructionId);
  await requireDraft(db, row.setId);
  await db
    .delete(caseJuryInstructions)
    .where(eq(caseJuryInstructions.id, instructionId));
}

/**
 * Bulk reorder. Two-pass scratch-and-commit to dodge the unique
 * (set_id, instruction_order) constraint. Final orders are 1..N in input order.
 */
export async function reorderInstructions(
  db: Db,
  setId: string,
  orderedIds: string[],
): Promise<void> {
  await requireDraft(db, setId);
  if (orderedIds.length === 0) return;
  const TEMP_OFFSET = 5000;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseJuryInstructions)
      .set({ instructionOrder: TEMP_OFFSET + i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseJuryInstructions.setId, setId),
          eq(caseJuryInstructions.id, orderedIds[i]),
        ),
      );
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(caseJuryInstructions)
      .set({ instructionOrder: i + 1, updatedAt: new Date() })
      .where(
        and(
          eq(caseJuryInstructions.setId, setId),
          eq(caseJuryInstructions.id, orderedIds[i]),
        ),
      );
  }
}

// Exposed for tests.
export const __testing = { bodiesEqual };
