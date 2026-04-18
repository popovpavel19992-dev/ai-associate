CREATE TYPE "public"."research_court_level" AS ENUM('scotus', 'circuit', 'district', 'state_supreme', 'state_appellate');--> statement-breakpoint
CREATE TYPE "public"."research_jurisdiction" AS ENUM('federal', 'ca', 'ny', 'tx', 'fl', 'il');--> statement-breakpoint
CREATE TYPE "public"."research_chat_mode" AS ENUM('broad', 'deep');--> statement-breakpoint
CREATE TYPE "public"."research_chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "cached_opinions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courtlistener_id" bigint NOT NULL,
	"citation_bluebook" text NOT NULL,
	"case_name" text NOT NULL,
	"court" text NOT NULL,
	"jurisdiction" "research_jurisdiction" NOT NULL,
	"court_level" "research_court_level" NOT NULL,
	"decision_date" date NOT NULL,
	"full_text" text,
	"snippet" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opinion_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"opinion_id" uuid NOT NULL,
	"case_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "research_chat_role" NOT NULL,
	"content" text NOT NULL,
	"mode" "research_chat_mode",
	"opinion_id" uuid,
	"opinion_context_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"query_text" text NOT NULL,
	"filters" jsonb,
	"result_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid,
	"title" text NOT NULL,
	"jurisdiction_filter" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"qa_count" integer DEFAULT 0 NOT NULL,
	"memo_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opinion_bookmarks" ADD CONSTRAINT "opinion_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_bookmarks" ADD CONSTRAINT "opinion_bookmarks_opinion_id_cached_opinions_id_fk" FOREIGN KEY ("opinion_id") REFERENCES "public"."cached_opinions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_bookmarks" ADD CONSTRAINT "opinion_bookmarks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_chat_messages" ADD CONSTRAINT "research_chat_messages_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_usage" ADD CONSTRAINT "research_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cached_opinions_courtlistener_unique" ON "cached_opinions" USING btree ("courtlistener_id");--> statement-breakpoint
CREATE INDEX "cached_opinions_juris_date_idx" ON "cached_opinions" USING btree ("jurisdiction","decision_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "opinion_bookmarks_user_opinion_unique" ON "opinion_bookmarks" USING btree ("user_id","opinion_id");--> statement-breakpoint
CREATE INDEX "opinion_bookmarks_user_created_idx" ON "opinion_bookmarks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "opinion_bookmarks_case_idx" ON "opinion_bookmarks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "research_chat_session_idx" ON "research_chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "research_queries_session_idx" ON "research_queries" USING btree ("session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "research_sessions_user_updated_idx" ON "research_sessions" USING btree ("user_id","deleted_at","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "research_sessions_case_idx" ON "research_sessions" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_usage_user_month_unique" ON "research_usage" USING btree ("user_id","month");