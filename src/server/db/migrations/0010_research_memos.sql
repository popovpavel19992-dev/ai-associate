-- 0010_research_memos.sql
-- Phase 2.2.3: research memo generation (IRAC). Two tables + two enums.
-- Hand-written (project convention). Apply with: psql "$DATABASE_URL" -f <file>.

CREATE TYPE "public"."research_memo_status" AS ENUM ('generating','ready','failed');
CREATE TYPE "public"."research_memo_section_type" AS ENUM ('issue','rule','application','conclusion');

CREATE TABLE "research_memos" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "session_id" uuid NOT NULL,
    "case_id" uuid,
    "title" text NOT NULL,
    "jurisdiction" "research_jurisdiction",
    "status" "research_memo_status" NOT NULL,
    "memo_question" text NOT NULL,
    "context_opinion_ids" uuid[] NOT NULL DEFAULT '{}',
    "context_statute_ids" uuid[] NOT NULL DEFAULT '{}',
    "flags" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "token_usage" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "credits_charged" integer NOT NULL DEFAULT 0,
    "error_message" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "deleted_at" timestamp with time zone
);

CREATE TABLE "research_memo_sections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "memo_id" uuid NOT NULL,
    "section_type" "research_memo_section_type" NOT NULL,
    "ord" integer NOT NULL,
    "content" text NOT NULL,
    "citations" text[] NOT NULL DEFAULT '{}',
    "ai_generated_at" timestamp with time zone NOT NULL,
    "user_edited_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "research_memo_sections_ord_check" CHECK ("ord" BETWEEN 1 AND 4)
);

ALTER TABLE "research_memos"
  ADD CONSTRAINT "research_memos_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_memos_session_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_memos_case_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null;

ALTER TABLE "research_memo_sections"
  ADD CONSTRAINT "research_memo_sections_memo_id_fk"
    FOREIGN KEY ("memo_id") REFERENCES "public"."research_memos"("id") ON DELETE cascade;

CREATE INDEX "research_memos_user_updated_idx"
  ON "research_memos" USING btree ("user_id","deleted_at","updated_at" DESC NULLS LAST);
CREATE INDEX "research_memos_case_idx"
  ON "research_memos" USING btree ("case_id");
CREATE INDEX "research_memos_session_idx"
  ON "research_memos" USING btree ("session_id");

CREATE UNIQUE INDEX "research_memo_sections_memo_type_unique"
  ON "research_memo_sections" USING btree ("memo_id","section_type");
CREATE INDEX "research_memo_sections_memo_ord_idx"
  ON "research_memo_sections" USING btree ("memo_id","ord");
