-- 0017_email_replies.sql
-- Phase 2.3.5b: email reply tracking.

CREATE TABLE "case_email_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outreach_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "reply_kind" text NOT NULL,
  "from_email" text NOT NULL,
  "from_name" text,
  "subject" text NOT NULL,
  "body_text" text,
  "body_html" text NOT NULL,
  "sender_mismatch" boolean NOT NULL DEFAULT false,
  "message_id" text,
  "in_reply_to" text,
  "resend_event_id" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_email_replies_kind_check" CHECK ("reply_kind" IN ('human','auto_reply'))
);

ALTER TABLE "case_email_replies"
  ADD CONSTRAINT "case_email_replies_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."case_email_outreach"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_replies_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_email_replies_event_id_unique" ON "case_email_replies" USING btree ("resend_event_id");
CREATE INDEX "case_email_replies_outreach_received_idx" ON "case_email_replies" USING btree ("outreach_id","received_at");
CREATE INDEX "case_email_replies_case_received_idx" ON "case_email_replies" USING btree ("case_id","received_at");

CREATE TABLE "case_email_reply_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reply_id" uuid NOT NULL,
  "s3_key" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "promoted_document_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "case_email_reply_attachments"
  ADD CONSTRAINT "case_email_reply_attachments_reply_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."case_email_replies"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_email_reply_attachments_doc_id_fk" FOREIGN KEY ("promoted_document_id") REFERENCES "public"."documents"("id") ON DELETE set null;

CREATE INDEX "case_email_reply_attachments_reply_idx" ON "case_email_reply_attachments" USING btree ("reply_id");

ALTER TABLE "case_email_outreach" DROP CONSTRAINT "case_email_outreach_status_check";
ALTER TABLE "case_email_outreach" ADD CONSTRAINT "case_email_outreach_status_check" CHECK ("status" IN ('sent','failed','bounced'));
ALTER TABLE "case_email_outreach" ADD COLUMN "bounce_reason" text;
ALTER TABLE "case_email_outreach" ADD COLUMN "bounced_at" timestamp with time zone;
ALTER TABLE "case_email_outreach" ADD COLUMN "lawyer_last_seen_replies_at" timestamp with time zone;
