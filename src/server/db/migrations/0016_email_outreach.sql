-- 0016_email_outreach.sql
-- Phase 2.3.5: templated email outreach.

CREATE TABLE "email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body_markdown" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "email_templates"
  ADD CONSTRAINT "email_templates_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  ADD CONSTRAINT "email_templates_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "email_templates_org_name_idx" ON "email_templates" USING btree ("org_id","name");

CREATE TABLE "case_email_outreach" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "template_id" uuid,
  "sent_by" uuid,
  "recipient_email" text NOT NULL,
  "recipient_name" text,
  "subject" text NOT NULL,
  "body_markdown" text NOT NULL,
  "body_html" text NOT NULL,
  "status" text NOT NULL,
  "error_message" text,
  "resend_id" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_email_outreach_status_check" CHECK ("status" IN ('sent','failed'))
);

ALTER TABLE "case_email_outreach"
  ADD CONSTRAINT "case_email_outreach_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_outreach_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null,
  ADD CONSTRAINT "case_email_outreach_sent_by_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "case_email_outreach_case_created_idx" ON "case_email_outreach" USING btree ("case_id","created_at");

CREATE TABLE "case_email_outreach_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL
);

ALTER TABLE "case_email_outreach_attachments"
  ADD CONSTRAINT "case_email_outreach_attachments_email_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."case_email_outreach"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_outreach_attachments_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict;

CREATE INDEX "case_email_outreach_attachments_email_idx" ON "case_email_outreach_attachments" USING btree ("email_id");
