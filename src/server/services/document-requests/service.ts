// src/server/services/document-requests/service.ts
import { TRPCError } from "@trpc/server";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { documentRequests } from "@/server/db/schema/document-requests";
import { documentRequestItems } from "@/server/db/schema/document-request-items";
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
}
