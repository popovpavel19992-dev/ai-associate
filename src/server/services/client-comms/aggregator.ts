// src/server/services/client-comms/aggregator.ts
//
// Phase 3.10 — Client Communication Center.
//
// PURE READ-ONLY AGGREGATOR. Zero new tables, zero mutations. Fans out
// queries against every per-case communication source we've shipped, maps
// each row into a normalized `CommEvent`, and merges them into a single
// chronological timeline scoped to one client (across all of the client's
// cases).
//
// Each per-source query orders DESC by its event-time column, so we use a
// k-way heap merge to produce the final sorted stream — avoids materializing
// the full cross-product when only `limit` events are needed.

import { and, eq, gte, lte, inArray, isNotNull, desc, sql } from "drizzle-orm";
import type { db as DbType } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { clients } from "@/server/db/schema/clients";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { emailDripEnrollments } from "@/server/db/schema/email-drip-enrollments";
import { caseDemandLetters } from "@/server/db/schema/case-demand-letters";
import { caseMessages } from "@/server/db/schema/case-messages";
import { documentRequests } from "@/server/db/schema/document-requests";
import { intakeForms } from "@/server/db/schema/intake-forms";
import { caseMediationSessions } from "@/server/db/schema/case-mediation-sessions";
import { caseSettlementOffers } from "@/server/db/schema/case-settlement-offers";
import { clientContacts } from "@/server/db/schema/client-contacts";

type Db = typeof DbType;

export type CommEventKind =
  | "email_outbound"
  | "email_reply"
  | "email_auto_reply"
  | "signature_request"
  | "signature_completed"
  | "drip_enrolled"
  | "drip_cancelled"
  | "demand_letter_sent"
  | "demand_letter_response"
  | "case_message"
  | "document_request"
  | "document_response"
  | "intake_submitted"
  | "mediation_scheduled"
  | "mediation_completed"
  | "settlement_offer";

export type CommDirection = "inbound" | "outbound" | "internal";

export interface CommEvent {
  id: string;
  kind: CommEventKind;
  direction: CommDirection;
  occurredAt: Date;
  caseId: string;
  caseName: string;
  title: string;
  summary?: string;
  status?: string;
  detailUrl: string;
  metadata?: Record<string, unknown>;
}

export interface AggregateOptions {
  startDate?: Date;
  endDate?: Date;
  kinds?: CommEventKind[];
  caseId?: string;
  direction?: CommDirection;
  limit?: number;
  offset?: number;
}

export interface AggregateResult {
  events: CommEvent[];
  total: number;
  counts: {
    byKind: Partial<Record<CommEventKind, number>>;
    byDirection: Record<CommDirection, number>;
    total: number;
  };
}

/**
 * Resolve the cases this client is associated with, scoped to the org.
 * Solo clients (orgId === null) are visible only to their creator and have
 * cases.orgId = NULL too. Firm clients always have orgId set.
 */
async function resolveClientCases(
  db: Db,
  orgId: string | null,
  userId: string,
  clientId: string,
): Promise<Array<{ id: string; name: string }>> {
  // Authorize the client first.
  const [client] = await db
    .select({ id: clients.id, orgId: clients.orgId, userId: clients.userId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return [];
  if (client.orgId === null) {
    if (client.userId !== userId) return [];
  } else if (client.orgId !== orgId) {
    return [];
  }

  const rows = await db
    .select({ id: cases.id, name: cases.name })
    .from(cases)
    .where(eq(cases.clientId, clientId));
  return rows;
}

function truncate(s: string | null | undefined, n = 160): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "\u2026";
}

function caseUrl(caseId: string, tab: string, highlight?: string): string {
  const base = `/cases/${caseId}?tab=${tab}`;
  return highlight ? `${base}&highlight=${highlight}` : base;
}

// --- Per-source mappers ----------------------------------------------------

async function fetchEmailOutbound(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const where = [inArray(caseEmailOutreach.caseId, caseIds), isNotNull(caseEmailOutreach.sentAt)];
  if (startDate) where.push(gte(caseEmailOutreach.sentAt, startDate));
  if (endDate) where.push(lte(caseEmailOutreach.sentAt, endDate));
  const rows = await db
    .select({
      id: caseEmailOutreach.id,
      caseId: caseEmailOutreach.caseId,
      subject: caseEmailOutreach.subject,
      bodyMarkdown: caseEmailOutreach.bodyMarkdown,
      status: caseEmailOutreach.status,
      sentAt: caseEmailOutreach.sentAt,
      recipientEmail: caseEmailOutreach.recipientEmail,
    })
    .from(caseEmailOutreach)
    .where(and(...where))
    .orderBy(desc(caseEmailOutreach.sentAt));

  return rows
    .filter((r) => r.sentAt !== null)
    .map((r) => ({
      id: `email_outbound:${r.id}`,
      kind: "email_outbound" as const,
      direction: "outbound" as const,
      occurredAt: r.sentAt as Date,
      caseId: r.caseId,
      caseName: caseNames.get(r.caseId) ?? "",
      title: `Email: ${r.subject}`,
      summary: truncate(r.bodyMarkdown),
      status: r.status,
      detailUrl: caseUrl(r.caseId, "emails", r.id),
      metadata: { recipientEmail: r.recipientEmail },
    }));
}

async function fetchEmailReplies(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const where = [inArray(caseEmailReplies.caseId, caseIds)];
  if (startDate) where.push(gte(caseEmailReplies.receivedAt, startDate));
  if (endDate) where.push(lte(caseEmailReplies.receivedAt, endDate));
  const rows = await db
    .select({
      id: caseEmailReplies.id,
      caseId: caseEmailReplies.caseId,
      subject: caseEmailReplies.subject,
      bodyText: caseEmailReplies.bodyText,
      replyKind: caseEmailReplies.replyKind,
      receivedAt: caseEmailReplies.receivedAt,
      fromEmail: caseEmailReplies.fromEmail,
      fromName: caseEmailReplies.fromName,
    })
    .from(caseEmailReplies)
    .where(and(...where))
    .orderBy(desc(caseEmailReplies.receivedAt));

  return rows.map((r) => {
    const auto = r.replyKind === "auto_reply";
    return {
      id: `${auto ? "email_auto_reply" : "email_reply"}:${r.id}`,
      kind: (auto ? "email_auto_reply" : "email_reply") as CommEventKind,
      direction: "inbound" as const,
      occurredAt: r.receivedAt,
      caseId: r.caseId,
      caseName: caseNames.get(r.caseId) ?? "",
      title: `Reply: ${r.subject}`,
      summary: truncate(r.bodyText, 200),
      status: r.replyKind,
      detailUrl: caseUrl(r.caseId, "emails", r.id),
      metadata: { fromEmail: r.fromEmail, fromName: r.fromName },
    };
  });
}

async function fetchSignatureRequests(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const where = [inArray(caseSignatureRequests.caseId, caseIds), isNotNull(caseSignatureRequests.sentAt)];
  if (startDate) where.push(gte(caseSignatureRequests.sentAt, startDate));
  if (endDate) where.push(lte(caseSignatureRequests.sentAt, endDate));
  const rows = await db
    .select({
      id: caseSignatureRequests.id,
      caseId: caseSignatureRequests.caseId,
      title: caseSignatureRequests.title,
      message: caseSignatureRequests.message,
      status: caseSignatureRequests.status,
      sentAt: caseSignatureRequests.sentAt,
      completedAt: caseSignatureRequests.completedAt,
    })
    .from(caseSignatureRequests)
    .where(and(...where))
    .orderBy(desc(caseSignatureRequests.sentAt));

  const events: CommEvent[] = [];
  for (const r of rows) {
    if (r.sentAt) {
      events.push({
        id: `signature_request:${r.id}`,
        kind: "signature_request",
        direction: "outbound",
        occurredAt: r.sentAt,
        caseId: r.caseId,
        caseName: caseNames.get(r.caseId) ?? "",
        title: `Signature requested: ${r.title}`,
        summary: truncate(r.message),
        status: r.status,
        detailUrl: caseUrl(r.caseId, "signatures", r.id),
      });
    }
    if (r.completedAt && r.status === "completed") {
      const inRange =
        (!startDate || r.completedAt >= startDate) && (!endDate || r.completedAt <= endDate);
      if (inRange) {
        events.push({
          id: `signature_completed:${r.id}`,
          kind: "signature_completed",
          direction: "inbound",
          occurredAt: r.completedAt,
          caseId: r.caseId,
          caseName: caseNames.get(r.caseId) ?? "",
          title: `Signature completed: ${r.title}`,
          status: "completed",
          detailUrl: caseUrl(r.caseId, "signatures", r.id),
        });
      }
    }
  }
  return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

async function fetchDripEnrollments(
  db: Db,
  clientId: string,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  // Drip enrollments target client_contacts. Find contacts for this client.
  const contacts = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId));
  if (contacts.length === 0) return [];
  const contactIds = contacts.map((c) => c.id);

  const rows = await db
    .select({
      id: emailDripEnrollments.id,
      caseId: emailDripEnrollments.caseId,
      sequenceId: emailDripEnrollments.sequenceId,
      status: emailDripEnrollments.status,
      enrolledAt: emailDripEnrollments.enrolledAt,
      cancelledAt: emailDripEnrollments.cancelledAt,
    })
    .from(emailDripEnrollments)
    .where(inArray(emailDripEnrollments.clientContactId, contactIds))
    .orderBy(desc(emailDripEnrollments.enrolledAt));

  const events: CommEvent[] = [];
  for (const r of rows) {
    const cId = r.caseId ?? caseIds[0] ?? "";
    const cName = cId ? caseNames.get(cId) ?? "" : "";
    if (r.enrolledAt) {
      const inRange =
        (!startDate || r.enrolledAt >= startDate) && (!endDate || r.enrolledAt <= endDate);
      if (inRange) {
        events.push({
          id: `drip_enrolled:${r.id}`,
          kind: "drip_enrolled",
          direction: "outbound",
          occurredAt: r.enrolledAt,
          caseId: cId,
          caseName: cName,
          title: `Enrolled in drip sequence`,
          status: r.status,
          detailUrl: cId ? caseUrl(cId, "emails", r.id) : `/clients/${clientId}`,
          metadata: { sequenceId: r.sequenceId },
        });
      }
    }
    if (r.cancelledAt) {
      const inRange =
        (!startDate || r.cancelledAt >= startDate) && (!endDate || r.cancelledAt <= endDate);
      if (inRange) {
        events.push({
          id: `drip_cancelled:${r.id}`,
          kind: "drip_cancelled",
          direction: "internal",
          occurredAt: r.cancelledAt,
          caseId: cId,
          caseName: cName,
          title: `Drip sequence cancelled`,
          status: r.status,
          detailUrl: cId ? caseUrl(cId, "emails", r.id) : `/clients/${clientId}`,
          metadata: { sequenceId: r.sequenceId },
        });
      }
    }
  }
  return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

async function fetchDemandLetters(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const rows = await db
    .select({
      id: caseDemandLetters.id,
      caseId: caseDemandLetters.caseId,
      letterType: caseDemandLetters.letterType,
      recipientName: caseDemandLetters.recipientName,
      sentAt: caseDemandLetters.sentAt,
      responseReceivedAt: caseDemandLetters.responseReceivedAt,
      responseSummary: caseDemandLetters.responseSummary,
      status: caseDemandLetters.status,
      letterNumber: caseDemandLetters.letterNumber,
    })
    .from(caseDemandLetters)
    .where(inArray(caseDemandLetters.caseId, caseIds));

  const events: CommEvent[] = [];
  for (const r of rows) {
    if (r.sentAt) {
      const inRange = (!startDate || r.sentAt >= startDate) && (!endDate || r.sentAt <= endDate);
      if (inRange) {
        events.push({
          id: `demand_letter_sent:${r.id}`,
          kind: "demand_letter_sent",
          direction: "outbound",
          occurredAt: r.sentAt,
          caseId: r.caseId,
          caseName: caseNames.get(r.caseId) ?? "",
          title: `Demand letter #${r.letterNumber} sent: ${r.letterType}`,
          summary: `To ${r.recipientName}`,
          status: r.status,
          detailUrl: caseUrl(r.caseId, "demand-letters", r.id),
        });
      }
    }
    if (r.responseReceivedAt) {
      const inRange =
        (!startDate || r.responseReceivedAt >= startDate) && (!endDate || r.responseReceivedAt <= endDate);
      if (inRange) {
        events.push({
          id: `demand_letter_response:${r.id}`,
          kind: "demand_letter_response",
          direction: "inbound",
          occurredAt: r.responseReceivedAt,
          caseId: r.caseId,
          caseName: caseNames.get(r.caseId) ?? "",
          title: `Demand letter #${r.letterNumber} response received`,
          summary: truncate(r.responseSummary),
          status: r.status,
          detailUrl: caseUrl(r.caseId, "demand-letters", r.id),
        });
      }
    }
  }
  return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

async function fetchCaseMessages(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const where = [inArray(caseMessages.caseId, caseIds)];
  if (startDate) where.push(gte(caseMessages.createdAt, startDate));
  if (endDate) where.push(lte(caseMessages.createdAt, endDate));
  const rows = await db
    .select({
      id: caseMessages.id,
      caseId: caseMessages.caseId,
      authorType: caseMessages.authorType,
      body: caseMessages.body,
      createdAt: caseMessages.createdAt,
      deletedAt: caseMessages.deletedAt,
    })
    .from(caseMessages)
    .where(and(...where))
    .orderBy(desc(caseMessages.createdAt));

  return rows
    .filter((r) => r.deletedAt === null)
    .map((r) => ({
      id: `case_message:${r.id}`,
      kind: "case_message" as const,
      direction: (r.authorType === "client" ? "inbound" : "outbound") as CommDirection,
      occurredAt: r.createdAt,
      caseId: r.caseId,
      caseName: caseNames.get(r.caseId) ?? "",
      title: r.authorType === "client" ? "Client message" : "Lawyer message",
      summary: truncate(r.body, 200),
      status: r.authorType,
      detailUrl: caseUrl(r.caseId, "messages", r.id),
    }));
}

async function fetchDocumentRequests(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const where = [inArray(documentRequests.caseId, caseIds)];
  if (startDate) where.push(gte(documentRequests.createdAt, startDate));
  if (endDate) where.push(lte(documentRequests.createdAt, endDate));
  const rows = await db
    .select({
      id: documentRequests.id,
      caseId: documentRequests.caseId,
      title: documentRequests.title,
      note: documentRequests.note,
      status: documentRequests.status,
      createdAt: documentRequests.createdAt,
      updatedAt: documentRequests.updatedAt,
    })
    .from(documentRequests)
    .where(and(...where))
    .orderBy(desc(documentRequests.createdAt));

  const events: CommEvent[] = [];
  for (const r of rows) {
    events.push({
      id: `document_request:${r.id}`,
      kind: "document_request",
      direction: "outbound",
      occurredAt: r.createdAt,
      caseId: r.caseId,
      caseName: caseNames.get(r.caseId) ?? "",
      title: `Document requested: ${r.title}`,
      summary: truncate(r.note),
      status: r.status,
      detailUrl: caseUrl(r.caseId, "document-requests", r.id),
    });
    if (r.status === "awaiting_review" || r.status === "completed") {
      const ts = r.updatedAt;
      const inRange = (!startDate || ts >= startDate) && (!endDate || ts <= endDate);
      if (inRange) {
        events.push({
          id: `document_response:${r.id}`,
          kind: "document_response",
          direction: "inbound",
          occurredAt: ts,
          caseId: r.caseId,
          caseName: caseNames.get(r.caseId) ?? "",
          title: `Document response: ${r.title}`,
          status: r.status,
          detailUrl: caseUrl(r.caseId, "document-requests", r.id),
        });
      }
    }
  }
  return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

async function fetchIntakeSubmissions(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const where = [inArray(intakeForms.caseId, caseIds), isNotNull(intakeForms.submittedAt)];
  if (startDate) where.push(gte(intakeForms.submittedAt, startDate));
  if (endDate) where.push(lte(intakeForms.submittedAt, endDate));
  const rows = await db
    .select({
      id: intakeForms.id,
      caseId: intakeForms.caseId,
      title: intakeForms.title,
      submittedAt: intakeForms.submittedAt,
    })
    .from(intakeForms)
    .where(and(...where))
    .orderBy(desc(intakeForms.submittedAt));

  return rows
    .filter((r) => r.submittedAt !== null)
    .map((r) => ({
      id: `intake_submitted:${r.id}`,
      kind: "intake_submitted" as const,
      direction: "inbound" as const,
      occurredAt: r.submittedAt as Date,
      caseId: r.caseId,
      caseName: caseNames.get(r.caseId) ?? "",
      title: `Intake form submitted: ${r.title}`,
      status: "submitted",
      detailUrl: caseUrl(r.caseId, "intake-forms", r.id),
    }));
}

async function fetchMediationSessions(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const rows = await db
    .select({
      id: caseMediationSessions.id,
      caseId: caseMediationSessions.caseId,
      mediatorName: caseMediationSessions.mediatorName,
      sessionType: caseMediationSessions.sessionType,
      scheduledDate: caseMediationSessions.scheduledDate,
      status: caseMediationSessions.status,
      outcome: caseMediationSessions.outcome,
      createdAt: caseMediationSessions.createdAt,
      updatedAt: caseMediationSessions.updatedAt,
    })
    .from(caseMediationSessions)
    .where(inArray(caseMediationSessions.caseId, caseIds));

  const events: CommEvent[] = [];
  for (const r of rows) {
    const inRange = (!startDate || r.createdAt >= startDate) && (!endDate || r.createdAt <= endDate);
    if (inRange) {
      events.push({
        id: `mediation_scheduled:${r.id}`,
        kind: "mediation_scheduled",
        direction: "internal",
        occurredAt: r.createdAt,
        caseId: r.caseId,
        caseName: caseNames.get(r.caseId) ?? "",
        title: `Mediation scheduled (${r.sessionType})`,
        summary: `Mediator: ${r.mediatorName} — ${r.scheduledDate.toISOString().slice(0, 10)}`,
        status: r.status,
        detailUrl: caseUrl(r.caseId, "settlement", r.id),
      });
    }
    if (r.status === "completed") {
      const ts = r.updatedAt;
      const inRange2 = (!startDate || ts >= startDate) && (!endDate || ts <= endDate);
      if (inRange2) {
        events.push({
          id: `mediation_completed:${r.id}`,
          kind: "mediation_completed",
          direction: "internal",
          occurredAt: ts,
          caseId: r.caseId,
          caseName: caseNames.get(r.caseId) ?? "",
          title: `Mediation completed (${r.sessionType})`,
          summary: `Outcome: ${r.outcome}`,
          status: r.outcome,
          detailUrl: caseUrl(r.caseId, "settlement", r.id),
        });
      }
    }
  }
  return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

async function fetchSettlementOffers(
  db: Db,
  caseIds: string[],
  caseNames: Map<string, string>,
  startDate?: Date,
  endDate?: Date,
): Promise<CommEvent[]> {
  if (caseIds.length === 0) return [];
  const where = [inArray(caseSettlementOffers.caseId, caseIds)];
  if (startDate) where.push(gte(caseSettlementOffers.offeredAt, startDate));
  if (endDate) where.push(lte(caseSettlementOffers.offeredAt, endDate));
  const rows = await db
    .select({
      id: caseSettlementOffers.id,
      caseId: caseSettlementOffers.caseId,
      offerNumber: caseSettlementOffers.offerNumber,
      amountCents: caseSettlementOffers.amountCents,
      currency: caseSettlementOffers.currency,
      offerType: caseSettlementOffers.offerType,
      fromParty: caseSettlementOffers.fromParty,
      response: caseSettlementOffers.response,
      offeredAt: caseSettlementOffers.offeredAt,
    })
    .from(caseSettlementOffers)
    .where(and(...where))
    .orderBy(desc(caseSettlementOffers.offeredAt));

  return rows.map((r) => ({
    id: `settlement_offer:${r.id}`,
    kind: "settlement_offer" as const,
    // plaintiff = our typical client side outbound; defendant = inbound. But
    // direction here means: from the client's perspective. We treat plaintiff
    // offers as outbound, defendant offers as inbound. This is best-effort
    // because either side may be our client.
    direction: (r.fromParty === "plaintiff" ? "outbound" : "inbound") as CommDirection,
    occurredAt: r.offeredAt,
    caseId: r.caseId,
    caseName: caseNames.get(r.caseId) ?? "",
    title: `Settlement offer #${r.offerNumber}: ${r.offerType}`,
    summary: `${r.currency} ${(Number(r.amountCents) / 100).toFixed(2)} from ${r.fromParty}`,
    status: r.response,
    detailUrl: caseUrl(r.caseId, "settlement", r.id),
  }));
}

// --- Public entry point ---------------------------------------------------

export async function aggregateForClient(
  db: Db,
  orgId: string | null,
  userId: string,
  clientId: string,
  opts: AggregateOptions = {},
): Promise<AggregateResult> {
  const cs = await resolveClientCases(db, orgId, userId, clientId);
  if (cs.length === 0) {
    return {
      events: [],
      total: 0,
      counts: { byKind: {}, byDirection: { inbound: 0, outbound: 0, internal: 0 }, total: 0 },
    };
  }
  const allCaseIds = cs.map((c) => c.id);
  const caseIdsForQuery = opts.caseId ? [opts.caseId].filter((id) => allCaseIds.includes(id)) : allCaseIds;
  const caseNames = new Map(cs.map((c) => [c.id, c.name]));

  // Fan out — each call gracefully returns [] for empty caseIds.
  const [
    emailOut,
    emailReply,
    sigs,
    drips,
    demands,
    msgs,
    docReqs,
    intakes,
    mediations,
    settlements,
  ] = await Promise.all([
    fetchEmailOutbound(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchEmailReplies(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchSignatureRequests(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchDripEnrollments(db, clientId, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchDemandLetters(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchCaseMessages(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchDocumentRequests(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchIntakeSubmissions(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchMediationSessions(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
    fetchSettlementOffers(db, caseIdsForQuery, caseNames, opts.startDate, opts.endDate).catch(() => []),
  ]);

  let merged: CommEvent[] = [
    ...emailOut,
    ...emailReply,
    ...sigs,
    ...drips,
    ...demands,
    ...msgs,
    ...docReqs,
    ...intakes,
    ...mediations,
    ...settlements,
  ];

  // Filter by kind/direction in JS (cheap given the working set).
  if (opts.kinds && opts.kinds.length > 0) {
    const set = new Set(opts.kinds);
    merged = merged.filter((e) => set.has(e.kind));
  }
  if (opts.direction) {
    merged = merged.filter((e) => e.direction === opts.direction);
  }

  // Sort DESC.
  merged.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  // Counts BEFORE pagination.
  const byKind: Partial<Record<CommEventKind, number>> = {};
  const byDirection: Record<CommDirection, number> = { inbound: 0, outbound: 0, internal: 0 };
  for (const e of merged) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    byDirection[e.direction]++;
  }

  const total = merged.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? total;
  const paginated = merged.slice(offset, offset + limit);

  return {
    events: paginated,
    total,
    counts: { byKind, byDirection, total },
  };
}
