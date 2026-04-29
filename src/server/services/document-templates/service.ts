// src/server/services/document-templates/service.ts
//
// Phase 3.12 — CRUD + lifecycle for firm document templates and the
// case_generated_documents instances rendered from them.

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, or, sql, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import {
  documentTemplates,
  type DocumentTemplate,
  type DocumentTemplateCategory,
  type VariableDef,
} from "@/server/db/schema/document-templates";
import {
  caseGeneratedDocuments,
  type CaseGeneratedDocument,
  type GeneratedDocumentStatus,
} from "@/server/db/schema/case-generated-documents";
import { cases } from "@/server/db/schema/cases";
import { clients } from "@/server/db/schema/clients";
import { organizations } from "@/server/db/schema/organizations";
import { users } from "@/server/db/schema/users";
import {
  autoFillFromContext,
  renderBody,
  type AutoFillScope,
} from "./merge-renderer";

type DB = typeof defaultDb;

const VALID_CATEGORIES: DocumentTemplateCategory[] = [
  "retainer", "engagement", "fee_agreement", "nda", "conflict_waiver",
  "termination", "demand", "settlement", "authorization", "other",
];

function ensureCategory(c: string): DocumentTemplateCategory {
  if ((VALID_CATEGORIES as string[]).includes(c)) return c as DocumentTemplateCategory;
  throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid template category: " + c });
}

export async function listLibraryTemplates(
  db: DB,
  orgId: string,
  category?: DocumentTemplateCategory,
): Promise<DocumentTemplate[]> {
  const scope = or(isNull(documentTemplates.orgId), eq(documentTemplates.orgId, orgId));
  const where = category
    ? and(scope, eq(documentTemplates.category, category), eq(documentTemplates.isActive, true))
    : and(scope, eq(documentTemplates.isActive, true));
  return db
    .select()
    .from(documentTemplates)
    .where(where)
    .orderBy(asc(documentTemplates.category), asc(documentTemplates.name));
}

export async function getTemplate(db: DB, templateId: string): Promise<DocumentTemplate> {
  const [row] = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, templateId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
  return row;
}

export interface CreateTemplateInput {
  orgId: string;
  category: string;
  name: string;
  description?: string | null;
  body: string;
  variables: VariableDef[];
}

export async function createTemplate(db: DB, input: CreateTemplateInput): Promise<DocumentTemplate> {
  const category = ensureCategory(input.category);
  const [row] = await db
    .insert(documentTemplates)
    .values({
      orgId: input.orgId,
      category,
      name: input.name,
      description: input.description ?? null,
      body: input.body,
      variables: input.variables,
      isActive: true,
      isGlobal: false,
    })
    .returning();
  return row;
}

export interface UpdateTemplateInput {
  templateId: string;
  orgId: string;
  patch: {
    category?: string;
    name?: string;
    description?: string | null;
    body?: string;
    variables?: VariableDef[];
    isActive?: boolean;
  };
}

export async function updateTemplate(db: DB, input: UpdateTemplateInput): Promise<DocumentTemplate> {
  const existing = await getTemplate(db, input.templateId);
  if (existing.orgId !== input.orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: existing.orgId === null
        ? "Global library templates are read-only — duplicate it to your firm to edit"
        : "Cannot edit another organization's template",
    });
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.patch.category !== undefined) patch.category = ensureCategory(input.patch.category);
  if (input.patch.name !== undefined) patch.name = input.patch.name;
  if (input.patch.description !== undefined) patch.description = input.patch.description;
  if (input.patch.body !== undefined) patch.body = input.patch.body;
  if (input.patch.variables !== undefined) patch.variables = input.patch.variables;
  if (input.patch.isActive !== undefined) patch.isActive = input.patch.isActive;

  await db.update(documentTemplates).set(patch).where(eq(documentTemplates.id, input.templateId));
  return getTemplate(db, input.templateId);
}

export async function deleteTemplate(db: DB, input: { templateId: string; orgId: string }): Promise<{ ok: true }> {
  const existing = await getTemplate(db, input.templateId);
  if (existing.orgId !== input.orgId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete this template" });
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(caseGeneratedDocuments)
    .where(eq(caseGeneratedDocuments.templateId, input.templateId));
  if (Number(count) > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot delete template referenced by generated documents — deactivate it instead",
    });
  }
  await db.delete(documentTemplates).where(eq(documentTemplates.id, input.templateId));
  return { ok: true as const };
}

async function loadAutoFillScope(
  db: DB,
  orgId: string,
  caseId: string | null,
  clientId: string | null,
): Promise<AutoFillScope> {
  const [org] = await db
    .select({
      name: organizations.name,
      ownerUserId: organizations.ownerUserId,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  let ownerName: string | null = null;
  let ownerBar: string | null = null;
  if (org?.ownerUserId) {
    const [u] = await db
      .select({ name: users.name, barNumber: users.barNumber })
      .from(users)
      .where(eq(users.id, org.ownerUserId))
      .limit(1);
    ownerName = u?.name ?? null;
    ownerBar = u?.barNumber ?? null;
  }

  const firm = {
    name: org?.name ?? null,
    address: null,
    attorneyName: ownerName,
    barNumber: ownerBar,
  };

  let caseRow: AutoFillScope["case"] = null;
  let resolvedClientId = clientId;
  if (caseId) {
    const [c] = await db
      .select({
        name: cases.name,
        caseNumber: cases.caseNumber,
        description: cases.description,
        opposingParty: cases.opposingParty,
        clientId: cases.clientId,
      })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    if (c) {
      caseRow = {
        name: c.name,
        caseNumber: c.caseNumber,
        description: c.description,
        opposingParty: c.opposingParty,
      };
      resolvedClientId = resolvedClientId ?? c.clientId;
    }
  }

  let clientRow: AutoFillScope["client"] = null;
  if (resolvedClientId) {
    const [cl] = await db
      .select({
        displayName: clients.displayName,
        addressLine1: clients.addressLine1,
        addressLine2: clients.addressLine2,
        city: clients.city,
        state: clients.state,
        zipCode: clients.zipCode,
      })
      .from(clients)
      .where(eq(clients.id, resolvedClientId))
      .limit(1);
    if (cl) clientRow = cl;
  }

  return { firm, case: caseRow, client: clientRow };
}

export interface GenerateFromTemplateInput {
  orgId: string;
  templateId: string;
  caseId?: string | null;
  clientId?: string | null;
  title?: string;
  variableValues: Record<string, string>;
  createdBy: string;
}

export async function generateFromTemplate(
  db: DB,
  input: GenerateFromTemplateInput,
): Promise<CaseGeneratedDocument> {
  if (!input.caseId && !input.clientId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "caseId or clientId is required" });
  }
  const tpl = await getTemplate(db, input.templateId);
  if (tpl.orgId !== null && tpl.orgId !== input.orgId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Template not available to this organization" });
  }
  const renderedBody = renderBody(tpl.body, {
    values: input.variableValues,
    variables: tpl.variables,
    missing: "placeholder",
  });
  const title = (input.title ?? tpl.name).trim();
  const [row] = await db
    .insert(caseGeneratedDocuments)
    .values({
      orgId: input.orgId,
      caseId: input.caseId ?? null,
      clientId: input.clientId ?? null,
      templateId: tpl.id,
      category: tpl.category,
      title,
      body: renderedBody,
      variablesFilled: input.variableValues,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

export async function getDoc(db: DB, docId: string): Promise<CaseGeneratedDocument> {
  const [row] = await db
    .select()
    .from(caseGeneratedDocuments)
    .where(eq(caseGeneratedDocuments.id, docId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  return row;
}

async function assertOrgOwnsDoc(db: DB, docId: string, orgId: string): Promise<CaseGeneratedDocument> {
  const doc = await getDoc(db, docId);
  if (doc.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Document not in your org" });
  return doc;
}

export interface UpdateGeneratedDocInput {
  orgId: string;
  docId: string;
  patch: {
    title?: string;
    body?: string;
    variableValues?: Record<string, string>;
  };
}

export async function updateGeneratedDoc(
  db: DB,
  input: UpdateGeneratedDocInput,
): Promise<CaseGeneratedDocument> {
  const doc = await assertOrgOwnsDoc(db, input.docId, input.orgId);
  if (doc.status !== "draft") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot edit a finalized document — supersede it and create a new draft instead",
    });
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.patch.title !== undefined) patch.title = input.patch.title;
  if (input.patch.body !== undefined) patch.body = input.patch.body;
  if (input.patch.variableValues !== undefined) patch.variablesFilled = input.patch.variableValues;
  await db.update(caseGeneratedDocuments).set(patch).where(eq(caseGeneratedDocuments.id, input.docId));
  return getDoc(db, input.docId);
}

export async function finalizeGeneratedDoc(
  db: DB,
  input: { orgId: string; docId: string },
): Promise<CaseGeneratedDocument> {
  const doc = await assertOrgOwnsDoc(db, input.docId, input.orgId);
  if (doc.status === "finalized" || doc.status === "sent") return doc;
  if (doc.status === "superseded") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot finalize a superseded document" });
  }
  await db
    .update(caseGeneratedDocuments)
    .set({ status: "finalized", finalizedAt: new Date(), updatedAt: new Date() })
    .where(eq(caseGeneratedDocuments.id, input.docId));
  return getDoc(db, input.docId);
}

export async function markSent(
  db: DB,
  input: { orgId: string; docId: string; sentAt?: Date | null },
): Promise<CaseGeneratedDocument> {
  const doc = await assertOrgOwnsDoc(db, input.docId, input.orgId);
  if (doc.status === "draft") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Finalize the document before marking it sent" });
  }
  if (doc.status === "superseded") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot mark a superseded document sent" });
  }
  const sentAt = input.sentAt ?? new Date();
  await db
    .update(caseGeneratedDocuments)
    .set({ status: "sent", sentAt, updatedAt: new Date() })
    .where(eq(caseGeneratedDocuments.id, input.docId));
  return getDoc(db, input.docId);
}

export async function supersedeGeneratedDoc(
  db: DB,
  input: { orgId: string; docId: string },
): Promise<CaseGeneratedDocument> {
  const doc = await assertOrgOwnsDoc(db, input.docId, input.orgId);
  if (doc.status === "superseded") return doc;
  await db
    .update(caseGeneratedDocuments)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(eq(caseGeneratedDocuments.id, input.docId));
  return getDoc(db, input.docId);
}

export async function listForCase(
  db: DB,
  input: { orgId: string; caseId: string },
): Promise<CaseGeneratedDocument[]> {
  return db
    .select()
    .from(caseGeneratedDocuments)
    .where(
      and(
        eq(caseGeneratedDocuments.orgId, input.orgId),
        eq(caseGeneratedDocuments.caseId, input.caseId),
      ),
    )
    .orderBy(desc(caseGeneratedDocuments.createdAt));
}

export async function listForClient(
  db: DB,
  input: { orgId: string; clientId: string },
): Promise<CaseGeneratedDocument[]> {
  return db
    .select()
    .from(caseGeneratedDocuments)
    .where(
      and(
        eq(caseGeneratedDocuments.orgId, input.orgId),
        eq(caseGeneratedDocuments.clientId, input.clientId),
      ),
    )
    .orderBy(desc(caseGeneratedDocuments.createdAt));
}

export async function getDocForOrg(
  db: DB,
  input: { orgId: string; docId: string },
): Promise<CaseGeneratedDocument> {
  return assertOrgOwnsDoc(db, input.docId, input.orgId);
}

export async function buildAutoFill(
  db: DB,
  input: { orgId: string; templateId: string; caseId?: string | null; clientId?: string | null },
): Promise<{ values: Record<string, string>; template: DocumentTemplate }> {
  const tpl = await getTemplate(db, input.templateId);
  const scope = await loadAutoFillScope(db, input.orgId, input.caseId ?? null, input.clientId ?? null);
  const values = autoFillFromContext(tpl.variables, scope);
  return { values, template: tpl };
}

// Re-export to keep public surface easy to discover.
export type { DocumentTemplate, DocumentTemplateCategory, VariableDef } from "@/server/db/schema/document-templates";
export type { CaseGeneratedDocument, GeneratedDocumentStatus } from "@/server/db/schema/case-generated-documents";

// Bulk fetch templates by ids — used internally; exported for completeness.
export async function getTemplatesByIds(db: DB, ids: string[]): Promise<DocumentTemplate[]> {
  if (ids.length === 0) return [];
  return db.select().from(documentTemplates).where(inArray(documentTemplates.id, ids));
}
