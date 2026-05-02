// TODO(4.9): no document-type filter — searches all case docs with deponent-focused query.
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { getEnv } from "@/lib/env";
import { embedTexts } from "@/server/services/case-strategy/voyage";

export interface SourceExcerpt {
  id: string;
  title: string;
  excerpt: string;
}

export async function collectDeponentSources(args: {
  caseId: string;
  deponentName: string;
  deponentRole: string;
  k?: number;
}): Promise<SourceExcerpt[]> {
  const env = getEnv();
  if (!env.VOYAGE_API_KEY) return [];
  const k = args.k ?? 8;
  const query = `${args.deponentName} ${args.deponentRole} statements declarations testimony documents related to deponent`;
  const [queryVec] = await embedTexts([query], "query");
  if (!queryVec || queryVec.length === 0) return [];
  if (!queryVec.every(Number.isFinite)) return [];
  if (queryVec.length !== 1024) return [];
  const queryLit = `[${queryVec.join(",")}]`;
  const rows = await db.execute<{ document_id: string; filename: string; content: string }>(sql`
    WITH q AS (SELECT ${queryLit}::vector AS v)
    SELECT de.document_id, COALESCE(d.filename, 'Untitled') AS filename, de.content
    FROM document_embeddings de
    JOIN documents d ON d.id = de.document_id
    CROSS JOIN q
    WHERE d.case_id = ${args.caseId}
    ORDER BY de.embedding <=> q.v
    LIMIT ${k}
  `);
  return (rows as Array<{ document_id: string; filename: string; content: string }>).map((r) => ({
    id: r.document_id,
    title: r.filename,
    excerpt: r.content,
  }));
}
