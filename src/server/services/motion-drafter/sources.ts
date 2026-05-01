import { inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema/documents";
import { embedTexts } from "@/server/services/case-strategy/voyage";
import { getEnv } from "@/lib/env";
import type { Citation, DocChunk } from "@/server/services/case-strategy/types";

export interface RecForSources {
  title: string;
  rationale: string;
  citations: Citation[];
}

export interface SourcesBundle {
  autoPulledChunks: DocChunk[];
  citedEntities: Citation[];
}

export async function bundleSources(
  caseId: string,
  rec: RecForSources,
): Promise<SourcesBundle> {
  const env = getEnv();

  const docCitations = rec.citations.filter((c) => c.kind === "document");
  let liveDocIds = new Set<string>();
  if (docCitations.length > 0) {
    const ids = docCitations.map((c) => c.id);
    const liveRows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(inArray(documents.id, ids));
    liveDocIds = new Set(liveRows.map((r) => r.id));
  }
  const citedEntities: Citation[] = rec.citations.filter(
    (c) => c.kind !== "document" || liveDocIds.has(c.id),
  );

  let autoPulledChunks: DocChunk[] = [];
  if (env.VOYAGE_API_KEY) {
    const [queryVec] = await embedTexts(
      [`${rec.title}. ${rec.rationale}`],
      "query",
    );
    if (queryVec && queryVec.length > 0) {
      const k = Number(env.STRATEGY_TOP_K_CHUNKS ?? 8);
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
      autoPulledChunks = rows.map((r) => ({
        documentId: r.document_id,
        documentTitle: r.document_title,
        chunkIndex: r.chunk_index,
        content: r.content,
        similarity: Number(r.similarity),
      }));
    }
  }

  return { autoPulledChunks, citedEntities };
}
