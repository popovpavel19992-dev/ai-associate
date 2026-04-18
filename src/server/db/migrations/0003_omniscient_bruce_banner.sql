CREATE TYPE "public"."statute_source" AS ENUM('usc', 'cfr');--> statement-breakpoint
CREATE TABLE "cached_statutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "statute_source" NOT NULL,
	"citation_bluebook" text NOT NULL,
	"title" text NOT NULL,
	"chapter" text,
	"section" text NOT NULL,
	"heading" text,
	"body_text" text,
	"effective_date" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_chat_messages" ADD COLUMN "statute_context_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cached_statutes_source_citation_unique" ON "cached_statutes" USING btree ("source","citation_bluebook");--> statement-breakpoint
CREATE INDEX "cached_statutes_source_section_idx" ON "cached_statutes" USING btree ("source","title","section");