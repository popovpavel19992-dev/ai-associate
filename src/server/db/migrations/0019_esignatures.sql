-- 0019_esignatures.sql
-- Phase 2.3.6: e-signature requests via Dropbox Sign.

CREATE TABLE "case_signature_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "created_by" uuid,
  "template_id" text,
  "source_document_id" uuid,
  "title" text NOT NULL,
  "message" text,
  "requires_countersign" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL,
  "hellosign_request_id" text,
  "signed_document_id" uuid,
  "certificate_s3_key" text,
  "test_mode" boolean NOT NULL DEFAULT false,
  "sent_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "declined_reason" text,
  "expired_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_signature_requests_status_check" CHECK ("status" IN ('draft','sent','in_progress','completed','declined','expired','cancelled'))
);

ALTER TABLE "case_signature_requests"
  ADD CONSTRAINT "case_signature_requests_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_signature_requests_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null,
  ADD CONSTRAINT "case_signature_requests_source_doc_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null,
  ADD CONSTRAINT "case_signature_requests_signed_doc_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."documents"("id") ON DELETE set null;

CREATE INDEX "case_signature_requests_case_created_idx" ON "case_signature_requests" USING btree ("case_id","created_at");
CREATE UNIQUE INDEX "case_signature_requests_hellosign_id_unique" ON "case_signature_requests" USING btree ("hellosign_request_id");

CREATE TABLE "case_signature_request_signers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "signer_role" text NOT NULL,
  "signer_order" integer NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "user_id" uuid,
  "client_contact_id" uuid,
  "status" text NOT NULL,
  "viewed_at" timestamp with time zone,
  "signed_at" timestamp with time zone,
  "hellosign_signature_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_signature_request_signers_role_check" CHECK ("signer_role" IN ('client','lawyer')),
  CONSTRAINT "case_signature_request_signers_status_check" CHECK ("status" IN ('awaiting_turn','awaiting_signature','signed','declined'))
);

ALTER TABLE "case_signature_request_signers"
  ADD CONSTRAINT "case_signature_request_signers_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."case_signature_requests"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_signature_request_signers_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null,
  ADD CONSTRAINT "case_signature_request_signers_contact_fk" FOREIGN KEY ("client_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null;

CREATE INDEX "case_signature_request_signers_request_order_idx" ON "case_signature_request_signers" USING btree ("request_id","signer_order");

CREATE TABLE "case_signature_request_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_at" timestamp with time zone NOT NULL,
  "event_hash" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "case_signature_request_events"
  ADD CONSTRAINT "case_signature_request_events_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."case_signature_requests"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_signature_request_events_hash_unique" ON "case_signature_request_events" USING btree ("event_hash");
CREATE INDEX "case_signature_request_events_request_at_idx" ON "case_signature_request_events" USING btree ("request_id","event_at");

ALTER TABLE "organizations"
  ADD COLUMN "hellosign_api_key_encrypted" text,
  ADD COLUMN "hellosign_sender_name" text;
