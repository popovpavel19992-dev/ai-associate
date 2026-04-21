-- 0018_email_tracking.sql
-- Phase 2.3.5c: open/click/delivered/complained tracking.

CREATE TABLE "case_email_outreach_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outreach_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_at" timestamp with time zone NOT NULL,
  "metadata" jsonb,
  "resend_event_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_email_outreach_events_type_check" CHECK ("event_type" IN ('delivered','opened','clicked','complained'))
);

ALTER TABLE "case_email_outreach_events"
  ADD CONSTRAINT "case_email_outreach_events_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."case_email_outreach"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_email_outreach_events_event_id_unique" ON "case_email_outreach_events" USING btree ("resend_event_id");
CREATE INDEX "case_email_outreach_events_outreach_event_idx" ON "case_email_outreach_events" USING btree ("outreach_id","event_at");

ALTER TABLE "case_email_outreach"
  ADD COLUMN "tracking_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "delivered_at" timestamp with time zone,
  ADD COLUMN "first_opened_at" timestamp with time zone,
  ADD COLUMN "last_opened_at" timestamp with time zone,
  ADD COLUMN "open_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "first_clicked_at" timestamp with time zone,
  ADD COLUMN "last_clicked_at" timestamp with time zone,
  ADD COLUMN "click_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "complained_at" timestamp with time zone;
