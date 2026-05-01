// TODO(4.7): no author-role column on `documents` yet — v1 searches all case docs.
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { getEnv } from "@/lib/env";
import { embedTexts } from "@/server/services/case-strategy/voyage";

export interface SourceExcerpt {
  id: string; // document_id
  title: string; // documents.filename
  excerpt: string; // chunk content
}

type RawRow = {
  document_id: string;
  filename: string;
  content: string;
  [key: string]: unknown;
};

export async function collectFilingSources(args: {
  caseId: string;
  query: string;
  k?: number;
}): Promise<SourceExcerpt[]> {
  const env = getEnv();
  if (!env.VOYAGE_API_KEY) return [];
  const k = args.k ?? 5;
  const [queryVec] = await embedTexts([args.query], "query");
  if (!queryVec || queryVec.length === 0) return [];
  const queryLit = `[${queryVec.join(",")}]`;

  const rows = await db.execute<RawRow>(sql`
    WITH q AS (SELECT ${queryLit}::vector AS v)
    SELECT de.document_id, COALESCE(d.filename, 'Untitled') AS filename, de.content
    FROM document_embeddings de
    JOIN documents d ON d.id = de.document_id
    CROSS JOIN q
    WHERE d.case_id = ${args.caseId}
    ORDER BY de.embedding <=> q.v
    LIMIT ${k}
  `);

  return (rows as unknown as RawRow[]).map((r) => ({
    id: r.document_id,
    title: r.filename,
    excerpt: r.content,
  }));
}

export async function collectPostureSources(args: {
  caseId: string;
  attorneyName: string;
}): Promise<SourceExcerpt[]> {
  return collectFilingSources({
    caseId: args.caseId,
    query: `opposing counsel ${args.attorneyName} motions arguments objections`,
    k: 12,
  });
}
