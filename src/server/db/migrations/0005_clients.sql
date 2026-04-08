-- Phase 2.1.5: Clients & Profiles (Client CRM)
--
-- Adds clients + client_contacts tables, client_id FK on cases, and a
-- Postgres GENERATED tsvector column for full-text search. Hand-written
-- delta migration (this project is not baselined with drizzle-kit generate;
-- see header of 0003_calendar_sync.sql).
--
-- Dependencies (must already exist): users, organizations, cases

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE TYPE "public"."client_type" AS ENUM('individual', 'organization');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'archived');--> statement-breakpoint

CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"user_id" uuid NOT NULL,
	"client_type" "client_type" NOT NULL,
	"display_name" text NOT NULL,
	"status" "client_status" NOT NULL DEFAULT 'active',
	"first_name" text,
	"last_name" text,
	"date_of_birth" date,
	"company_name" text,
	"ein" text,
	"industry" text,
	"website" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"country" text DEFAULT 'US',
	"notes" text,
	"search_vector" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
		setweight(to_tsvector('english', coalesce(company_name, '')), 'A') ||
		setweight(to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'A') ||
		setweight(to_tsvector('english', coalesce(industry, '')), 'B') ||
		setweight(to_tsvector('english', coalesce(notes, '')), 'C')
	) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_type_required_fields" CHECK (
		(client_type = 'individual' AND first_name IS NOT NULL AND last_name IS NOT NULL)
		OR
		(client_type = 'organization' AND company_name IS NOT NULL)
	)
);--> statement-breakpoint

ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_clients_org_active" ON "clients" ("org_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "idx_clients_solo_active" ON "clients" ("user_id") WHERE org_id IS NULL AND status = 'active';--> statement-breakpoint
CREATE INDEX "idx_clients_search_vector" ON "clients" USING GIN ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_clients_updated_at" ON "clients" ("updated_at" DESC);--> statement-breakpoint

CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"is_primary" boolean NOT NULL DEFAULT false,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_client_contacts_client" ON "client_contacts" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_client_contacts_one_primary" ON "client_contacts" ("client_id") WHERE is_primary = true;--> statement-breakpoint

ALTER TABLE "cases" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_cases_client" ON "cases" ("client_id") WHERE client_id IS NOT NULL;
