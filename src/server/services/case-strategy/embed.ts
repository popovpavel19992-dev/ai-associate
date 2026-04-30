import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema/documents";
import { documentEmbeddings } from "@/server/db/schema/document-embeddings";
import { embedTexts } from "./voyage";
import { chunkText } from "./chunking";
import { CHUNK_MAX_TOKENS, CHUNK_OVERLAP_TOKENS, VOYAGE_MODEL } from "./constants";

export interface EmbedResult {
  documentId: string;
  chunks: number;
  skipped?: "no-text" | "no-api-key";
}

export async function embedDocument(documentId: string): Promise<EmbedResult> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));

  if (!doc || !doc.extractedText) {
    return { documentId, chunks: 0, skipped: "no-text" };
  }

  const chunks = chunkText(doc.extractedText, {
    maxTokens: CHUNK_MAX_TOKENS,
    overlapTokens: CHUNK_OVERLAP_TOKENS,
  });
  if (chunks.length === 0) {
    return { documentId, chunks: 0, skipped: "no-text" };
  }

  let vectors: number[][];
  try {
    vectors = await embedTexts(chunks, "document");
  } catch (err) {
    if (err instanceof Error && err.message.includes("VOYAGE_API_KEY")) {
      return { documentId, chunks: 0, skipped: "no-api-key" };
    }
    throw err;
  }

  // Replace strategy: delete prior chunks for this doc, insert fresh
  await db
    .delete(documentEmbeddings)
    .where(eq(documentEmbeddings.documentId, documentId));

  const rows = chunks.map((content, chunkIndex) => ({
    documentId,
    chunkIndex,
    content,
    embedding: vectors[chunkIndex],
    modelVersion: VOYAGE_MODEL,
  }));

  await db.insert(documentEmbeddings).values(rows).onConflictDoNothing();

  return { documentId, chunks: rows.length };
}
