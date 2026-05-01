import { sql, or, ilike } from "drizzle-orm";
import { db } from "@/server/db";
import { cachedStatutes } from "@/server/db/schema/cached-statutes";
import { embedTexts } from "@/server/services/case-strategy/voyage";
import type { DemandClaimType, SourceExcerpt, StatuteExcerpt } from "./types";

const STATUTE_KEYWORDS: Record<DemandClaimType, string[]> = {
  contract: ["contract", "breach", "UCC", "agreement"],
  personal_injury: ["negligence", "tort", "personal injury", "duty of care"],
  employment: ["wage", "employment", "wrongful termination", "discrimination"],
  debt: ["debt collection", "fdcpa", "credit", "consumer"],
};

export async function fetchCaseDocsExcerpts(
  caseId: string,
  query: string,
  k = 5,
): Promise<SourceExcerpt[]> {
  if (!query.trim()) return [];
  const [vec] = await embedTexts([query], "query");
  if (!vec) return [];
  const queryLit = `[${vec.join(",")}]`;
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
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.document_title,
    snippet: r.content,
    score: Number(r.similarity),
  }));
}

export async function fetchStatutesForClaim(
  claimType: DemandClaimType,
  k = 3,
): Promise<StatuteExcerpt[]> {
  const keywords = STATUTE_KEYWORDS[claimType];
  if (!keywords.length) return [];
  const conds = keywords.flatMap((kw) => [
    ilike(cachedStatutes.bodyText, `%${kw}%`),
    ilike(cachedStatutes.heading, `%${kw}%`),
  ]);
  const rows = await db
    .select({
      citation: cachedStatutes.citationBluebook,
      source: cachedStatutes.source,
      bodyText: cachedStatutes.bodyText,
    })
    .from(cachedStatutes)
    .where(or(...conds))
    .limit(k);
  return rows.map((r) => ({
    citation: r.citation,
    jurisdiction: r.source === "usc" ? "U.S. Code" : "C.F.R.",
    text: (r.bodyText ?? "").slice(0, 800),
  }));
}
