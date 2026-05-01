import {
  pgTable, uuid, integer, text, timestamp, customType, unique, index,
} from "drizzle-orm/pg-core";
import { documents } from "./documents";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(1024)"; },
  toDriver(v) { return `[${v.join(",")}]`; },
});

export const documentEmbeddings = pgTable(
  "document_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding").notNull(),
    modelVersion: text("model_version").notNull().default("voyage-law-2"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("document_embeddings_doc_chunk_model_unique")
      .on(t.documentId, t.chunkIndex, t.modelVersion),
    index("document_embeddings_doc_idx").on(t.documentId),
  ],
);

export type DocumentEmbedding = typeof documentEmbeddings.$inferSelect;
export type NewDocumentEmbedding = typeof documentEmbeddings.$inferInsert;
