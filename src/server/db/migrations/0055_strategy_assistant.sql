-- src/server/db/migrations/0055_strategy_assistant.sql
-- Phase 4.2 — AI Case Strategy Assistant.
-- Adds pgvector + 4 tables (document_embeddings, case_strategy_runs,
-- case_strategy_recommendations, case_strategy_chat_messages).

CREATE EXTENSION IF NOT EXISTS vector;

-- 1) Document embeddings (RAG store) ---------------------------------------
CREATE TABLE IF NOT EXISTS "document_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "model_version" text NOT NULL DEFAULT 'voyage-law-2',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_embeddings_doc_chunk_model_unique"
  ON "document_embeddings" ("document_id", "chunk_index", "model_version");
CREATE INDEX IF NOT EXISTS "document_embeddings_doc_idx"
  ON "document_embeddings" ("document_id");
CREATE INDEX IF NOT EXISTS "document_embeddings_ann"
  ON "document_embeddings" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 2) Strategy runs ---------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "strategy_run_status" AS ENUM ('pending','succeeded','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "case_strategy_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "triggered_by" uuid NOT NULL REFERENCES "users"("id"),
  "status" "strategy_run_status" NOT NULL DEFAULT 'pending',
  "input_hash" text,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "credits_charged" integer NOT NULL DEFAULT 0,
  "model_version" text NOT NULL,
  "raw_response" jsonb,
  "error_message" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "case_strategy_runs_case_started_idx"
  ON "case_strategy_runs" ("case_id", "started_at");

-- 3) Recommendations -------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "strategy_category" AS ENUM ('procedural','discovery','substantive','client');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "case_strategy_recommendations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "case_strategy_runs"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "category" "strategy_category" NOT NULL,
  "priority" integer NOT NULL CHECK ("priority" BETWEEN 1 AND 5),
  "title" text NOT NULL,
  "rationale" text NOT NULL,
  "citations" jsonb NOT NULL DEFAULT '[]',
  "dismissed_at" timestamptz,
  "dismissed_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "case_strategy_recs_case_active_idx"
  ON "case_strategy_recommendations" ("case_id", "dismissed_at");

-- 4) Chat messages ---------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "strategy_chat_role" AS ENUM ('user','assistant');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "case_strategy_chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "role" "strategy_chat_role" NOT NULL,
  "body" text NOT NULL,
  "references_run_id" uuid REFERENCES "case_strategy_runs"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "case_strategy_chat_case_created_idx"
  ON "case_strategy_chat_messages" ("case_id", "created_at");
