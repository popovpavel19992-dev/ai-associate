// src/server/services/bulk-operations/service.ts
//
// Phase 3.15 — Bulk operations on cases.
//
// Each public function runs inside a single DB transaction so partial failures
// roll back. Permission gating (owner/admin only) is enforced at the tRPC
// layer; these functions trust their `orgId` argument and only verify that
// every target row belongs to that org.

import { and, desc, eq, inArray } from "drizzle-orm";
import { cases } from "@/server/db/schema/cases";
import { caseStages } from "@/server/db/schema/case-stages";
import { caseMembers } from "@/server/db/schema/case-members";
import { clients } from "@/server/db/schema/clients";
import { users } from "@/server/db/schema/users";
import {
  bulkActionLogs,
  type BulkActionLog,
} from "@/server/db/schema/bulk-action-logs";

type Db = any;

/** RFC 4180 CSV escape. Wrap in quotes if the value contains a comma,
 *  quote, CR, or LF; double up internal quotes. Null becomes empty. */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface BulkResult {
  count: number;
  logId: string;
}

const ARCHIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// --- Archive --------------------------------------------------------------

export interface BulkArchiveInput {
  orgId: string;
  caseIds: string[];
  performedBy: string;
}

export async function bulkArchive(
  db: Db,
  input: BulkArchiveInput,
): Promise<{ archived: number; logId: string }> {
  const { orgId, caseIds, performedBy } = input;
  if (caseIds.length === 0) {
    throw new Error("caseIds must not be empty");
  }

  return await db.transaction(async (tx: Db) => {
    // Validate every caseId belongs to the org. Reject if any mismatch.
    const found = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(and(inArray(cases.id, caseIds), eq(cases.orgId, orgId)));
    if (found.length !== caseIds.length) {
      throw new Error("One or more cases do not belong to this organization");
    }

    const deleteAt = new Date(Date.now() + ARCHIVE_TTL_MS);
    await tx
      .update(cases)
      .set({ deleteAt, updatedAt: new Date() })
      .where(and(inArray(cases.id, caseIds), eq(cases.orgId, orgId)));

    const [log] = await tx
      .insert(bulkActionLogs)
      .values({
        orgId,
        performedBy,
        actionType: "archive",
        targetCaseIds: caseIds,
        targetCount: caseIds.length,
        parameters: { deleteAt: deleteAt.toISOString() },
        summary: `Archived ${caseIds.length} case(s) — auto-delete in 30 days.`,
      })
      .returning({ id: bulkActionLogs.id });

    return { archived: caseIds.length, logId: log.id };
  });
}

// --- Reassign lead --------------------------------------------------------

export interface BulkReassignLeadInput {
  orgId: string;
  caseIds: string[];
  newLeadUserId: string;
  performedBy: string;
}

export async function bulkReassignLead(
  db: Db,
  input: BulkReassignLeadInput,
): Promise<{ reassigned: number; logId: string }> {
  const { orgId, caseIds, newLeadUserId, performedBy } = input;
  if (caseIds.length === 0) {
    throw new Error("caseIds must not be empty");
  }

  return await db.transaction(async (tx: Db) => {
    // Validate every caseId belongs to the org.
    const found = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(and(inArray(cases.id, caseIds), eq(cases.orgId, orgId)));
    if (found.length !== caseIds.length) {
      throw new Error("One or more cases do not belong to this organization");
    }

    // Validate newLeadUserId is a member of the org.
    const [newLead] = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.id, newLeadUserId), eq(users.orgId, orgId)))
      .limit(1);
    if (!newLead) {
      throw new Error("New lead is not a member of this organization");
    }

    // Update cases.userId to the new lead.
    await tx
      .update(cases)
      .set({ userId: newLeadUserId, updatedAt: new Date() })
      .where(and(inArray(cases.id, caseIds), eq(cases.orgId, orgId)));

    // Demote any existing 'lead' rows in case_members for these cases.
    await tx
      .update(caseMembers)
      .set({ role: "contributor" })
      .where(
        and(inArray(caseMembers.caseId, caseIds), eq(caseMembers.role, "lead")),
      );

    // Upsert (caseId, newLeadUserId) -> lead. We can't rely on .onConflict
    // because we want to flip role to 'lead' if a contributor row already
    // exists. Strategy: try insert per case, fall back to update if unique
    // index trips.
    for (const caseId of caseIds) {
      const [existing] = await tx
        .select({ id: caseMembers.id })
        .from(caseMembers)
        .where(
          and(
            eq(caseMembers.caseId, caseId),
            eq(caseMembers.userId, newLeadUserId),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .update(caseMembers)
          .set({ role: "lead", assignedBy: performedBy })
          .where(eq(caseMembers.id, existing.id));
      } else {
        await tx.insert(caseMembers).values({
          caseId,
          userId: newLeadUserId,
          role: "lead",
          assignedBy: performedBy,
        });
      }
    }

    const [log] = await tx
      .insert(bulkActionLogs)
      .values({
        orgId,
        performedBy,
        actionType: "reassign_lead",
        targetCaseIds: caseIds,
        targetCount: caseIds.length,
        parameters: { newLeadUserId, newLeadName: newLead.name ?? newLead.email },
        summary: `Reassigned lead to ${newLead.name ?? newLead.email} on ${caseIds.length} case(s).`,
      })
      .returning({ id: bulkActionLogs.id });

    return { reassigned: caseIds.length, logId: log.id };
  });
}

// --- Export CSV -----------------------------------------------------------

export interface BulkExportCsvInput {
  orgId: string;
  caseIds: string[];
  performedBy: string;
}

const CSV_HEADERS = [
  "id",
  "name",
  "client_name",
  "case_type",
  "stage_name",
  "status",
  "lead_attorney_name",
  "opposing_party",
  "created_at",
  "updated_at",
  "jurisdiction",
] as const;

export async function bulkExportCsv(
  db: Db,
  input: BulkExportCsvInput,
): Promise<{ csvText: string; logId: string }> {
  const { orgId, caseIds, performedBy } = input;
  if (caseIds.length === 0) {
    throw new Error("caseIds must not be empty");
  }

  return await db.transaction(async (tx: Db) => {
    // Pull cases + joins in a single query.
    const rows = await tx
      .select({
        id: cases.id,
        name: cases.name,
        status: cases.status,
        detectedCaseType: cases.detectedCaseType,
        overrideCaseType: cases.overrideCaseType,
        opposingParty: cases.opposingParty,
        jurisdictionOverride: cases.jurisdictionOverride,
        createdAt: cases.createdAt,
        updatedAt: cases.updatedAt,
        clientDisplayName: clients.displayName,
        stageName: caseStages.name,
        leadName: users.name,
        leadEmail: users.email,
      })
      .from(cases)
      .leftJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(caseStages, eq(caseStages.id, cases.stageId))
      .leftJoin(users, eq(users.id, cases.userId))
      .where(and(inArray(cases.id, caseIds), eq(cases.orgId, orgId)));

    if (rows.length !== caseIds.length) {
      throw new Error("One or more cases do not belong to this organization");
    }

    // Preserve caller's caseId order for deterministic output.
    const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));
    const ordered = caseIds.map((id) => byId.get(id) as any);

    const lines: string[] = [];
    lines.push(CSV_HEADERS.map(csvEscape).join(","));
    for (const r of ordered) {
      const caseType = r.overrideCaseType ?? r.detectedCaseType ?? "";
      const leadDisplay = r.leadName ?? r.leadEmail ?? "";
      lines.push(
        [
          r.id,
          r.name,
          r.clientDisplayName,
          caseType,
          r.stageName,
          r.status,
          leadDisplay,
          r.opposingParty,
          r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
          r.jurisdictionOverride,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    // RFC 4180 line terminator is CRLF.
    const csvText = lines.join("\r\n") + "\r\n";

    const [log] = await tx
      .insert(bulkActionLogs)
      .values({
        orgId,
        performedBy,
        actionType: "export_csv",
        targetCaseIds: caseIds,
        targetCount: caseIds.length,
        parameters: { columns: CSV_HEADERS },
        summary: `Exported ${caseIds.length} case(s) to CSV.`,
      })
      .returning({ id: bulkActionLogs.id });

    return { csvText, logId: log.id };
  });
}

// --- List logs ------------------------------------------------------------

export interface ListLogsOpts {
  limit?: number;
  offset?: number;
}

export async function listLogs(
  db: Db,
  orgId: string,
  opts: ListLogsOpts = {},
): Promise<{ logs: (BulkActionLog & { performedByName: string | null })[] }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const rows = await db
    .select({
      id: bulkActionLogs.id,
      orgId: bulkActionLogs.orgId,
      performedBy: bulkActionLogs.performedBy,
      actionType: bulkActionLogs.actionType,
      targetCaseIds: bulkActionLogs.targetCaseIds,
      targetCount: bulkActionLogs.targetCount,
      parameters: bulkActionLogs.parameters,
      summary: bulkActionLogs.summary,
      performedAt: bulkActionLogs.performedAt,
      performedByName: users.name,
    })
    .from(bulkActionLogs)
    .leftJoin(users, eq(users.id, bulkActionLogs.performedBy))
    .where(eq(bulkActionLogs.orgId, orgId))
    .orderBy(desc(bulkActionLogs.performedAt))
    .limit(limit)
    .offset(offset);

  return { logs: rows };
}
