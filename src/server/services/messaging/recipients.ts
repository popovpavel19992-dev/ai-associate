// src/server/services/messaging/recipients.ts
//
// Shared recipient-resolution helpers used by 2.3.2 document-request-broadcast,
// 2.3.3 intake-form-broadcast, and future broadcast fns.

import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseMembers } from "@/server/db/schema/case-members";
import { portalUsers } from "@/server/db/schema/portal-users";

export async function portalRecipients(clientId: string | null): Promise<string[]> {
  if (!clientId) return [];
  const rows = await defaultDb
    .select({ id: portalUsers.id })
    .from(portalUsers)
    .where(eq(portalUsers.clientId, clientId));
  return rows.map((r) => r.id);
}

export async function lawyerRecipients(caseId: string, ownerId: string | null): Promise<string[]> {
  const members = await defaultDb
    .select({ userId: caseMembers.userId })
    .from(caseMembers)
    .where(eq(caseMembers.caseId, caseId));
  const set = new Set<string>(members.map((m) => m.userId));
  if (ownerId) set.add(ownerId);
  return [...set];
}
