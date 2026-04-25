// src/server/services/discovery/service.ts
//
// Discovery (interrogatories / RFPs / RFAs) service layer for ClearTerms 3.1.1.
// Wave 1A landed the schemas; this module owns the lifecycle (draft → final →
// served) plus library-template lookup. Renderer + UI live in later waves.

import { and, eq, isNull, max, or } from "drizzle-orm";
import { discoveryRequestTemplates } from "@/server/db/schema/discovery-request-templates";
import {
  caseDiscoveryRequests,
  type DiscoveryQuestion,
} from "@/server/db/schema/case-discovery-requests";

// Re-export for convenience so callers can import a single module.
export type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";

// `db` is intentionally typed loose: callers pass either the prod Drizzle
// client or a tx handle inside transactions. Tests pass a hand-rolled mock.
type Db = any;

const FEDERAL_INTERROGATORY_CAP = 25;

export interface LibraryTemplateRow {
  id: string;
  caseType: string;
  title: string;
  description: string | null;
  questionCount: number;
}

export async function listLibraryTemplates(
  db: Db,
  orgId: string,
  caseType?: string,
): Promise<LibraryTemplateRow[]> {
  // Visibility: global templates (orgId IS NULL) plus the caller's org-specific
  // templates. Active only.
  const orgScope = or(
    isNull(discoveryRequestTemplates.orgId),
    eq(discoveryRequestTemplates.orgId, orgId),
  );
  const where = caseType
    ? and(eq(discoveryRequestTemplates.isActive, true), orgScope, eq(discoveryRequestTemplates.caseType, caseType))
    : and(eq(discoveryRequestTemplates.isActive, true), orgScope);

  const rows = await db
    .select({
      id: discoveryRequestTemplates.id,
      caseType: discoveryRequestTemplates.caseType,
      title: discoveryRequestTemplates.title,
      description: discoveryRequestTemplates.description,
      questions: discoveryRequestTemplates.questions,
    })
    .from(discoveryRequestTemplates)
    .where(where);

  return rows.map((r: { id: string; caseType: string; title: string; description: string | null; questions: unknown }) => ({
    id: r.id,
    caseType: r.caseType,
    title: r.title,
    description: r.description,
    questionCount: Array.isArray(r.questions) ? r.questions.length : 0,
  }));
}

export async function getTemplate(
  db: Db,
  templateId: string,
): Promise<{ id: string; title: string; questions: string[] }> {
  const [row] = await db
    .select()
    .from(discoveryRequestTemplates)
    .where(eq(discoveryRequestTemplates.id, templateId))
    .limit(1);
  if (!row) throw new Error("Discovery template not found");
  // Library templates store questions as `string[]` (raw text only — numbering
  // is assigned at copy-into-case time).
  const questions = Array.isArray(row.questions) ? (row.questions as string[]) : [];
  return { id: row.id, title: row.title, questions };
}

export interface CreateDiscoveryRequestInput {
  orgId: string;
  caseId: string;
  servingParty: "plaintiff" | "defendant";
  setNumber: number;
  title: string;
  templateSource: "library" | "ai" | "manual" | "mixed";
  questions: DiscoveryQuestion[];
  createdBy: string;
}

function normalizeQuestions(qs: DiscoveryQuestion[]): DiscoveryQuestion[] {
  // Always renumber 1..N to keep numbering canonical. Caller-provided numbers
  // are advisory; the lawyer expects "Interrogatory No. 1, 2, ..." regardless
  // of how the array was assembled (template + AI + manual mix).
  return qs.map((q, i) => ({
    number: i + 1,
    text: q.text,
    source: q.source,
    subparts: q.subparts && q.subparts.length > 0 ? q.subparts : undefined,
  }));
}

export async function createDiscoveryRequest(
  db: Db,
  input: CreateDiscoveryRequestInput,
): Promise<{ id: string }> {
  const questions = normalizeQuestions(input.questions);
  const [inserted] = await db
    .insert(caseDiscoveryRequests)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      requestType: "interrogatories",
      servingParty: input.servingParty,
      setNumber: input.setNumber,
      title: input.title,
      status: "draft",
      templateSource: input.templateSource,
      questions,
      createdBy: input.createdBy,
    })
    .returning({ id: caseDiscoveryRequests.id });
  return { id: inserted.id };
}

export async function getNextSetNumber(
  db: Db,
  caseId: string,
  requestType: string,
): Promise<number> {
  const [row] = await db
    .select({ maxSet: max(caseDiscoveryRequests.setNumber) })
    .from(caseDiscoveryRequests)
    .where(
      and(
        eq(caseDiscoveryRequests.caseId, caseId),
        eq(caseDiscoveryRequests.requestType, requestType),
      ),
    );
  const current = row?.maxSet ?? null;
  return (current ?? 0) + 1;
}

export async function updateDiscoveryRequest(
  db: Db,
  requestId: string,
  patch: { title?: string; questions?: DiscoveryQuestion[] },
): Promise<void> {
  const [row] = await db
    .select({ status: caseDiscoveryRequests.status })
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!row) throw new Error("Discovery request not found");
  if (row.status !== "draft") {
    throw new Error("Only draft discovery requests can be edited");
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.questions !== undefined) set.questions = normalizeQuestions(patch.questions);

  await db
    .update(caseDiscoveryRequests)
    .set(set)
    .where(eq(caseDiscoveryRequests.id, requestId));
}

export async function finalizeDiscoveryRequest(
  db: Db,
  requestId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!row) throw new Error("Discovery request not found");
  if (row.status !== "draft") {
    throw new Error("Only draft discovery requests can be finalized");
  }
  const questions = (row.questions ?? []) as DiscoveryQuestion[];
  // FRCP 33(a)(1): no more than 25 written interrogatories, including all
  // discrete subparts. We enforce on the question count only — subpart-aware
  // counting is left for a future revision since "discrete" is judgment-laden.
  if (questions.length > FEDERAL_INTERROGATORY_CAP) {
    throw new Error(
      `Federal cap exceeded: ${questions.length} interrogatories (max ${FEDERAL_INTERROGATORY_CAP})`,
    );
  }
  await db
    .update(caseDiscoveryRequests)
    .set({ status: "final", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseDiscoveryRequests.id, requestId));
}

export async function markServed(
  db: Db,
  requestId: string,
  servedAt: Date,
): Promise<void> {
  const [row] = await db
    .select({ status: caseDiscoveryRequests.status })
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!row) throw new Error("Discovery request not found");
  if (row.status !== "final") {
    throw new Error("Discovery request must be finalized before being served");
  }
  await db
    .update(caseDiscoveryRequests)
    .set({ status: "served", servedAt, updatedAt: new Date() })
    .where(eq(caseDiscoveryRequests.id, requestId));
}

export async function deleteDiscoveryRequest(
  db: Db,
  requestId: string,
): Promise<void> {
  const [row] = await db
    .select({ status: caseDiscoveryRequests.status })
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!row) throw new Error("Discovery request not found");
  if (row.status === "served") {
    // Preserve audit trail — once served, the request is part of the case
    // record and can only be archived (a future status), never deleted.
    throw new Error("Served discovery requests cannot be deleted");
  }
  await db.delete(caseDiscoveryRequests).where(eq(caseDiscoveryRequests.id, requestId));
}

export async function listForCase(
  db: Db,
  caseId: string,
): Promise<(typeof caseDiscoveryRequests.$inferSelect)[]> {
  return db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.caseId, caseId))
    .orderBy(caseDiscoveryRequests.requestType, caseDiscoveryRequests.setNumber);
}

export async function getDiscoveryRequest(
  db: Db,
  requestId: string,
): Promise<typeof caseDiscoveryRequests.$inferSelect> {
  const [row] = await db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!row) throw new Error("Discovery request not found");
  return row;
}

export const __FEDERAL_INTERROGATORY_CAP = FEDERAL_INTERROGATORY_CAP;
