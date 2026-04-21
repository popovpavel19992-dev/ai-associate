-- 0013_document_requests.sql
-- Phase 2.3.2: document request workflow.

CREATE TABLE "document_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "note" text,
  "due_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'open',
  "created_by" uuid,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_requests_status_check" CHECK ("status" IN ('open','awaiting_review','completed','cancelled'))
);

ALTER TABLE "document_requests"
  ADD CONSTRAINT "document_requests_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "document_requests_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "document_requests_case_status_idx" ON "document_requests" USING btree ("case_id","status");
CREATE INDEX "document_requests_case_created_idx" ON "document_requests" USING btree ("case_id","created_at");

CREATE TABLE "document_request_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'pending',
  "rejection_note" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_request_items_status_check" CHECK ("status" IN ('pending','uploaded','reviewed','rejected'))
);

ALTER TABLE "document_request_items"
  ADD CONSTRAINT "document_request_items_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."document_requests"("id") ON DELETE cascade;

CREATE INDEX "document_request_items_request_sort_idx" ON "document_request_items" USING btree ("request_id","sort_order");

CREATE TABLE "document_request_item_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "item_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "uploaded_by_portal_user_id" uuid,
  "uploaded_by_user_id" uuid,
  "archived" boolean NOT NULL DEFAULT false,
  "uploaded_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_request_item_files_uploader_check" CHECK (
    (uploaded_by_portal_user_id IS NOT NULL AND uploaded_by_user_id IS NULL)
    OR (uploaded_by_portal_user_id IS NULL AND uploaded_by_user_id IS NOT NULL)
  )
);

ALTER TABLE "document_request_item_files"
  ADD CONSTRAINT "document_request_item_files_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."document_request_items"("id") ON DELETE cascade,
  ADD CONSTRAINT "document_request_item_files_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict,
  ADD CONSTRAINT "document_request_item_files_portal_user_fk" FOREIGN KEY ("uploaded_by_portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null,
  ADD CONSTRAINT "document_request_item_files_user_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "document_request_item_files_item_archived_idx" ON "document_request_item_files" USING btree ("item_id","archived");
CREATE UNIQUE INDEX "document_request_item_files_item_doc_unique" ON "document_request_item_files" USING btree ("item_id","document_id");
