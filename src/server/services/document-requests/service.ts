// src/server/services/document-requests/service.ts
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { documentRequests } from "@/server/db/schema/document-requests";
import { documentRequestItems } from "@/server/db/schema/document-request-items";
import { documentRequestItemFiles } from "@/server/db/schema/document-request-item-files";
import { documents } from "@/server/db/schema/documents";
import { inngest as defaultInngest } from "@/server/inngest/client";

export interface DocumentRequestsServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export interface CreateRequestInput {
  caseId: string;
  title: string;
  note?: string;
  dueAt?: Date | null;
  items: Array<{ name: string; description?: string }>;
  createdBy: string;
}

export class DocumentRequestsService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: DocumentRequestsServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  async createRequest(input: CreateRequestInput): Promise<{ requestId: string }> {
    if (input.items.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "At least one item required" });
    }
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(documentRequests)
        .values({
          caseId: input.caseId,
          title: input.title,
          note: input.note ?? null,
          dueAt: input.dueAt ?? null,
          status: "open",
          createdBy: input.createdBy,
        })
        .returning();
      await tx.insert(documentRequestItems).values(
        input.items.map((it, idx) => ({
          requestId: row.id,
          name: it.name,
          description: it.description ?? null,
          sortOrder: idx,
          status: "pending" as const,
        })),
      );
      return row;
    });
    await this.inngest.send({
      name: "messaging/document_request.created",
      data: {
        requestId: result.id,
        caseId: input.caseId,
        createdBy: input.createdBy,
      },
    });
    return { requestId: result.id };
  }

  async getRequest(input: { requestId: string }) {
    const [request] = await this.db
      .select()
      .from(documentRequests)
      .where(eq(documentRequests.id, input.requestId))
      .limit(1);
    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
    const items = await this.db
      .select()
      .from(documentRequestItems)
      .where(eq(documentRequestItems.requestId, input.requestId))
      .orderBy(asc(documentRequestItems.sortOrder));
    return { request, items };
  }

  async listForCase(input: { caseId: string }) {
    const requests = await this.db
      .select()
      .from(documentRequests)
      .where(eq(documentRequests.caseId, input.caseId))
      .orderBy(desc(documentRequests.updatedAt));
    if (requests.length === 0) {
      return { requests: [] as Array<(typeof requests)[number] & { itemCount: number; reviewedCount: number }> };
    }
    const counts = await this.db
      .select({
        requestId: documentRequestItems.requestId,
        total: sql<number>`count(*)::int`,
        reviewed: sql<number>`sum(case when ${documentRequestItems.status} = 'reviewed' then 1 else 0 end)::int`,
      })
      .from(documentRequestItems)
      .where(inArray(documentRequestItems.requestId, requests.map((r) => r.id)))
      .groupBy(documentRequestItems.requestId);
    const map = new Map(counts.map((c) => [c.requestId, c]));
    return {
      requests: requests.map((r) => ({
        ...r,
        itemCount: map.get(r.id)?.total ?? 0,
        reviewedCount: map.get(r.id)?.reviewed ?? 0,
      })),
    };
  }

  async updateMeta(input: {
    requestId: string;
    title?: string;
    note?: string | null;
    dueAt?: Date | null;
  }): Promise<void> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.note !== undefined) patch.note = input.note;
    if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
    await this.db.update(documentRequests).set(patch).where(eq(documentRequests.id, input.requestId));
  }

  async addItem(input: { requestId: string; name: string; description?: string; sortOrder?: number }): Promise<{ itemId: string }> {
    const sortOrder = input.sortOrder ?? (await this.nextSortOrder(input.requestId));
    const [row] = await this.db
      .insert(documentRequestItems)
      .values({
        requestId: input.requestId,
        name: input.name,
        description: input.description ?? null,
        sortOrder,
        status: "pending",
      })
      .returning();
    await this.recomputeRequestStatus(input.requestId);
    return { itemId: row.id };
  }

  async updateItem(input: { itemId: string; name?: string; description?: string | null; sortOrder?: number }): Promise<void> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
    await this.db.update(documentRequestItems).set(patch).where(eq(documentRequestItems.id, input.itemId));
  }

  async removeItem(input: { itemId: string }): Promise<void> {
    const [item] = await this.db
      .select({ requestId: documentRequestItems.requestId })
      .from(documentRequestItems)
      .where(eq(documentRequestItems.id, input.itemId))
      .limit(1);
    if (!item) return;
    await this.db.delete(documentRequestItems).where(eq(documentRequestItems.id, input.itemId));
    await this.recomputeRequestStatus(item.requestId);
  }

  private async nextSortOrder(requestId: string): Promise<number> {
    const [row] = await this.db
      .select({ max: sql<number>`coalesce(max(${documentRequestItems.sortOrder}), -1)::int` })
      .from(documentRequestItems)
      .where(eq(documentRequestItems.requestId, requestId));
    return (row?.max ?? -1) + 1;
  }

  /** Returns { prior, next } so callers know when to fire the "submitted" event. */
  async recomputeRequestStatus(requestId: string): Promise<{ prior: string; next: string }> {
    const [req] = await this.db
      .select({ status: documentRequests.status })
      .from(documentRequests)
      .where(eq(documentRequests.id, requestId))
      .limit(1);
    if (!req) return { prior: "", next: "" };
    if (req.status === "cancelled") return { prior: req.status, next: req.status };

    const items = await this.db
      .select({ status: documentRequestItems.status })
      .from(documentRequestItems)
      .where(eq(documentRequestItems.requestId, requestId));

    let next: string;
    if (items.length === 0) {
      next = "open";
    } else if (items.every((i) => i.status === "reviewed")) {
      next = "completed";
    } else if (items.some((i) => i.status === "pending" || i.status === "rejected")) {
      next = "open";
    } else {
      next = "awaiting_review";
    }
    if (next !== req.status) {
      await this.db
        .update(documentRequests)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(documentRequests.id, requestId));
    }
    return { prior: req.status, next };
  }

  async reviewItem(input: { itemId: string }): Promise<void> {
    const [item] = await this.db
      .select({ requestId: documentRequestItems.requestId, status: documentRequestItems.status })
      .from(documentRequestItems)
      .where(eq(documentRequestItems.id, input.itemId))
      .limit(1);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
    if (item.status !== "uploaded") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only uploaded items can be reviewed" });
    }
    await this.db
      .update(documentRequestItems)
      .set({ status: "reviewed", rejectionNote: null, updatedAt: new Date() })
      .where(eq(documentRequestItems.id, input.itemId));
    const transition = await this.recomputeRequestStatus(item.requestId);
    if (transition.next === "awaiting_review" && transition.prior === "open") {
      await this.fireSubmittedEvent(item.requestId);
    }
  }

  async rejectItem(input: { itemId: string; rejectionNote: string }): Promise<void> {
    if (!input.rejectionNote.trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Rejection note required" });
    }
    const [item] = await this.db
      .select({ requestId: documentRequestItems.requestId, status: documentRequestItems.status, name: documentRequestItems.name })
      .from(documentRequestItems)
      .where(eq(documentRequestItems.id, input.itemId))
      .limit(1);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
    if (item.status !== "uploaded") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only uploaded items can be rejected" });
    }
    await this.db
      .update(documentRequestItems)
      .set({ status: "rejected", rejectionNote: input.rejectionNote, updatedAt: new Date() })
      .where(eq(documentRequestItems.id, input.itemId));
    await this.recomputeRequestStatus(item.requestId);
    await this.inngest.send({
      name: "messaging/document_request.item_rejected",
      data: {
        requestId: item.requestId,
        itemId: input.itemId,
        itemName: item.name,
        rejectionNote: input.rejectionNote,
      },
    });
  }

  async cancelRequest(input: { requestId: string; cancelledBy: string }): Promise<void> {
    const [existing] = await this.db
      .select({ status: documentRequests.status })
      .from(documentRequests)
      .where(eq(documentRequests.id, input.requestId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
    if (existing.status === "cancelled") return;
    await this.db
      .update(documentRequests)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(documentRequests.id, input.requestId));
    await this.inngest.send({
      name: "messaging/document_request.cancelled",
      data: {
        requestId: input.requestId,
        cancelledBy: input.cancelledBy,
      },
    });
  }

  private async fireSubmittedEvent(requestId: string): Promise<void> {
    await this.inngest.send({
      name: "messaging/document_request.submitted",
      data: { requestId },
    });
  }

  async uploadItemFile(input: {
    itemId: string;
    documentId: string;
    uploadedByPortalUserId?: string;
    uploadedByUserId?: string;
  }): Promise<{ joinId: string }> {
    if (!input.uploadedByPortalUserId === !input.uploadedByUserId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Exactly one uploader must be specified" });
    }
    const [item] = await this.db
      .select({ id: documentRequestItems.id, requestId: documentRequestItems.requestId, name: documentRequestItems.name })
      .from(documentRequestItems)
      .where(eq(documentRequestItems.id, input.itemId))
      .limit(1);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

    const [join] = await this.db
      .insert(documentRequestItemFiles)
      .values({
        itemId: input.itemId,
        documentId: input.documentId,
        uploadedByPortalUserId: input.uploadedByPortalUserId ?? null,
        uploadedByUserId: input.uploadedByUserId ?? null,
        archived: false,
      })
      .returning();

    await this.db
      .update(documentRequestItems)
      .set({ status: "uploaded", rejectionNote: null, updatedAt: new Date() })
      .where(and(eq(documentRequestItems.id, input.itemId), inArray(documentRequestItems.status, ["pending", "rejected"])));

    const transition = await this.recomputeRequestStatus(item.requestId);

    await this.inngest.send({
      name: "messaging/document_request.item_uploaded",
      data: {
        requestId: item.requestId,
        itemId: input.itemId,
        itemName: item.name,
        documentId: input.documentId,
      },
    });
    if (transition.next === "awaiting_review" && transition.prior === "open") {
      await this.fireSubmittedEvent(item.requestId);
    }
    return { joinId: join.id };
  }

  async replaceItemFile(input: {
    itemId: string;
    oldJoinId: string;
    newDocumentId: string;
    uploadedByPortalUserId?: string;
    uploadedByUserId?: string;
  }): Promise<{ joinId: string }> {
    await this.db
      .update(documentRequestItemFiles)
      .set({ archived: true })
      .where(eq(documentRequestItemFiles.id, input.oldJoinId));
    return this.uploadItemFile({
      itemId: input.itemId,
      documentId: input.newDocumentId,
      uploadedByPortalUserId: input.uploadedByPortalUserId,
      uploadedByUserId: input.uploadedByUserId,
    });
  }

  async listItemFiles(input: { itemId: string; includeArchived?: boolean }) {
    const conds = [eq(documentRequestItemFiles.itemId, input.itemId)];
    if (!input.includeArchived) conds.push(eq(documentRequestItemFiles.archived, false));
    return this.db
      .select({
        id: documentRequestItemFiles.id,
        itemId: documentRequestItemFiles.itemId,
        documentId: documentRequestItemFiles.documentId,
        filename: documents.filename,
        archived: documentRequestItemFiles.archived,
        uploadedAt: documentRequestItemFiles.uploadedAt,
      })
      .from(documentRequestItemFiles)
      .leftJoin(documents, eq(documents.id, documentRequestItemFiles.documentId))
      .where(and(...conds))
      .orderBy(desc(documentRequestItemFiles.uploadedAt));
  }
}
