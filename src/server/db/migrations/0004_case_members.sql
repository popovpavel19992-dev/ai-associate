-- Phase 2.1.4: Team Collaboration
--
-- Adds case_member_role enum and case_members table for case-level access control.
-- Includes backfill: existing case creators become leads on their cases.
-- Hand-written delta migration (see 0003 header for rationale).
--
-- Dependencies (must already exist): users, cases, organizations

CREATE TYPE "public"."case_member_role" AS ENUM('lead', 'contributor');--> statement-breakpoint

CREATE TABLE "case_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "case_member_role" NOT NULL DEFAULT 'contributor',
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_members_case_user_unique" UNIQUE("case_id","user_id")
);--> statement-breakpoint

ALTER TABLE "case_members" ADD CONSTRAINT "case_members_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_members" ADD CONSTRAINT "case_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_members" ADD CONSTRAINT "case_members_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "case_members_case_idx" ON "case_members" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_members_user_idx" ON "case_members" USING btree ("user_id");--> statement-breakpoint

-- Backfill: existing case creators become leads on their cases (only for org cases)
INSERT INTO "case_members" ("case_id", "user_id", "role", "assigned_by")
SELECT c."id", c."user_id", 'lead', c."user_id"
FROM "cases" c
WHERE c."org_id" IS NOT NULL
ON CONFLICT DO NOTHING;
