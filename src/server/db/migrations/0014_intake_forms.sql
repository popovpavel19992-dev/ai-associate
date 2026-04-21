-- 0014_intake_forms.sql
-- Phase 2.3.3: intake forms / questionnaires.

CREATE TABLE "intake_forms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "schema" jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" uuid,
  "sent_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "intake_forms_status_check" CHECK ("status" IN ('draft','sent','in_progress','submitted','cancelled'))
);

ALTER TABLE "intake_forms"
  ADD CONSTRAINT "intake_forms_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "intake_forms_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "intake_forms_case_status_idx" ON "intake_forms" USING btree ("case_id","status");
CREATE INDEX "intake_forms_case_created_idx" ON "intake_forms" USING btree ("case_id","created_at");

CREATE TABLE "intake_form_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_id" uuid NOT NULL,
  "field_id" text NOT NULL,
  "value_text" text,
  "value_number" numeric,
  "value_date" date,
  "value_bool" boolean,
  "value_json" jsonb,
  "document_id" uuid,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "intake_form_answers"
  ADD CONSTRAINT "intake_form_answers_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_forms"("id") ON DELETE cascade,
  ADD CONSTRAINT "intake_form_answers_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict;

CREATE UNIQUE INDEX "intake_form_answers_form_field_unique" ON "intake_form_answers" USING btree ("form_id","field_id");
CREATE INDEX "intake_form_answers_form_idx" ON "intake_form_answers" USING btree ("form_id");
