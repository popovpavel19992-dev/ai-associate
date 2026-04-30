import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { getEnv } from "@/lib/env";
import { embedTexts } from "./voyage";
import { buildCaseDigest } from "./aggregate";
import type { CollectedContext, DocChunk } from "./types";

// Note: Phase B's Inngest fan-out (extract-document → embed-document) is the
// source of truth for document embeddings. We deliberately do NOT lazy-embed
// here — if a doc lacks embeddings it simply won't appear in top-K.

export async function collectContext(caseId: string): Promise<CollectedContext> {
  const digest = await buildCaseDigest(caseId);
  const env = getEnv();

  let chunks: DocChunk[] = [];
  if (env.VOYAGE_API_KEY && digest.recentActivity) {
    const queryText = `${digest.caption.plaintiff ?? ""} v ${digest.caption.defendant ?? ""}. ${digest.recentActivity}`;
    const [queryVec] = await embedTexts([queryText], "query");
    const k = Number(env.STRATEGY_TOP_K_CHUNKS ?? 12);
    const queryLit = `[${queryVec.join(",")}]`;

    const rows = await db.execute<{
      document_id: string;
      document_title: string;
      chunk_index: number;
      content: string;
      similarity: number;
    }>(sql`
      WITH q AS (SELECT ${queryLit}::vector AS v)
      SELECT
        de.document_id,
        COALESCE(d.filename, 'Untitled') AS document_title,
        de.chunk_index,
        de.content,
        1 - (de.embedding <=> q.v) AS similarity
      FROM document_embeddings de
      JOIN documents d ON d.id = de.document_id
      CROSS JOIN q
      WHERE d.case_id = ${caseId}
      ORDER BY de.embedding <=> q.v
      LIMIT ${k}
    `);

    chunks = (rows as Array<{
      document_id: string;
      document_title: string;
      chunk_index: number;
      content: string;
      similarity: number;
    }>).map((r) => ({
      documentId: r.document_id,
      documentTitle: r.document_title,
      chunkIndex: r.chunk_index,
      content: r.content,
      similarity: Number(r.similarity),
    }));
  }

  return {
    digest,
    chunks,
    validIds: {
      documents: new Set(digest.documents.map((d) => d.id)),
      deadlines: new Set(digest.upcomingDeadlines.map((d) => d.id)),
      filings: new Set(digest.recentFilings.map((f) => f.id)),
      motions: new Set(digest.recentMotions.map((m) => m.id)),
      messages: new Set(digest.recentMessages.map((m) => m.id)),
    },
  };
}
