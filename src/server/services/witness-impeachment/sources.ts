// TODO(4.10): no document-type filter — searches all case docs except the statement docs themselves.
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { getEnv } from "@/lib/env";
import { embedTexts } from "@/server/services/case-strategy/voyage";

export interface SourceExcerpt {
  id: string;
  title: string;
  excerpt: string;
}

export async function collectEvidenceSources(args: {
  caseId: string;
  witnessName: string;
  excludeDocumentIds: string[];
  query: string;
  k?: number;
}): Promise<SourceExcerpt[]> {
  const env = getEnv();
  if (!env.VOYAGE_API_KEY) return [];
  const k = args.k ?? 15;
  const composedQuery = `${args.witnessName} ${args.query}`;
  const [queryVec] = await embedTexts([composedQuery], "query");
  if (!queryVec || queryVec.length === 0) return [];
  if (!queryVec.every(Number.isFinite)) return [];
  if (queryVec.length !== 1024) return [];
  const queryLit = `[${queryVec.join(",")}]`;
  // sql.raw is safe here: excludeDocumentIds are uuids from caseWitnessStatements.documentId
  // (our own schema). We additionally filter through a strict UUID regex before serializing,
  // as defense-in-depth against any future caller passing un-validated IDs. Drizzle's array
  // binding for IN with raw `sql` is awkward, so we serialize the IN-list directly.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeExclude = args.excludeDocumentIds.filter((id) => UUID_RE.test(id));
  const excludeClause = safeExclude.length > 0
    ? sql`AND d.id NOT IN ${sql.raw(`('${safeExclude.join("','")}')`)}`
    : sql``;
  const rows = await db.execute<{ document_id: string; filename: string; content: string }>(sql`
    WITH q AS (SELECT ${queryLit}::vector AS v)
    SELECT de.document_id, COALESCE(d.filename, 'Untitled') AS filename, de.content
    FROM document_embeddings de
    JOIN documents d ON d.id = de.document_id
    CROSS JOIN q
    WHERE d.case_id = ${args.caseId}
      ${excludeClause}
    ORDER BY de.embedding <=> q.v
    LIMIT ${k}
  `);
  return (rows as Array<{ document_id: string; filename: string; content: string }>).map((r) => ({
    id: r.document_id,
    title: r.filename,
    excerpt: r.content,
  }));
}
