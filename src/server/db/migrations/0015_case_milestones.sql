-- 0015_case_milestones.sql
-- Phase 2.3.4: client-facing status timeline / milestones.

CREATE TABLE "case_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "document_id" uuid,
  "retracted_reason" text,
  "created_by" uuid,
  "retracted_by" uuid,
  "published_at" timestamp with time zone,
  "retracted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_milestones_status_check" CHECK ("status" IN ('draft','published','retracted')),
  CONSTRAINT "case_milestones_category_check" CHECK ("category" IN ('filing','discovery','hearing','settlement','communication','other'))
);

ALTER TABLE "case_milestones"
  ADD CONSTRAINT "case_milestones_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_milestones_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null,
  ADD CONSTRAINT "case_milestones_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null,
  ADD CONSTRAINT "case_milestones_retracted_by_fk" FOREIGN KEY ("retracted_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "case_milestones_case_status_idx" ON "case_milestones" USING btree ("case_id","status");
CREATE INDEX "case_milestones_case_occurred_idx" ON "case_milestones" USING btree ("case_id","occurred_at");
