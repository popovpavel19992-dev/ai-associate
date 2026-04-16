ALTER TABLE "cases" ADD COLUMN "opposing_party" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "opposing_counsel" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bar_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bar_state" text; -- bar_state = state of bar admission; state = practice state--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signature_image_url" text;