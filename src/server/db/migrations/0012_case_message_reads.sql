-- 0012_case_message_reads.sql
-- Phase 2.3.1: lawyer-side read tracking for case messages + attachment column.

CREATE TABLE "case_message_reads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "case_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "last_read_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "case_message_reads"
  ADD CONSTRAINT "case_message_reads_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_message_reads_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_message_reads_case_user_unique"
  ON "case_message_reads" USING btree ("case_id","user_id");
CREATE INDEX "case_message_reads_user_case_idx"
  ON "case_message_reads" USING btree ("user_id","case_id");

-- Defensive: add document_id to case_messages if not present (2.1.8 didn't ship it).
ALTER TABLE "case_messages"
  ADD COLUMN IF NOT EXISTS "document_id" uuid REFERENCES "public"."documents"("id") ON DELETE SET NULL;
