-- 0011_research_collections.sql
-- Phase 2.2.4: research collections (universal organizer for opinions/statutes/memos/sessions).
-- Hand-written. Apply with: psql "$DATABASE_URL" -f <file>.

CREATE TYPE "public"."research_collection_item_type" AS ENUM ('opinion','statute','memo','session');

CREATE TABLE "research_collections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "org_id" uuid,
    "case_id" uuid,
    "name" text NOT NULL,
    "description" text,
    "shared_with_org" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "deleted_at" timestamp with time zone
);

CREATE TABLE "research_collection_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "collection_id" uuid NOT NULL,
    "item_type" "research_collection_item_type" NOT NULL,
    "opinion_id" uuid,
    "statute_id" uuid,
    "memo_id" uuid,
    "session_id" uuid,
    "notes" text,
    "position" integer NOT NULL DEFAULT 0,
    "added_by" uuid,
    "added_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "research_collection_items_polymorphic_check" CHECK (
      (item_type = 'opinion' AND opinion_id IS NOT NULL AND statute_id IS NULL AND memo_id IS NULL AND session_id IS NULL)
   OR (item_type = 'statute' AND statute_id IS NOT NULL AND opinion_id IS NULL AND memo_id IS NULL AND session_id IS NULL)
   OR (item_type = 'memo' AND memo_id IS NOT NULL AND opinion_id IS NULL AND statute_id IS NULL AND session_id IS NULL)
   OR (item_type = 'session' AND session_id IS NOT NULL AND opinion_id IS NULL AND statute_id IS NULL AND memo_id IS NULL)
    )
);

CREATE TABLE "research_item_tags" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "collection_item_id" uuid NOT NULL,
    "tag" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "research_item_tags_length_check" CHECK (length(tag) BETWEEN 1 AND 50)
);

ALTER TABLE "research_collections"
  ADD CONSTRAINT "research_collections_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_collections_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_collections_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null;

ALTER TABLE "research_collection_items"
  ADD CONSTRAINT "research_collection_items_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."research_collections"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_collection_items_opinion_id_fk" FOREIGN KEY ("opinion_id") REFERENCES "public"."cached_opinions"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_collection_items_statute_id_fk" FOREIGN KEY ("statute_id") REFERENCES "public"."cached_statutes"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_collection_items_memo_id_fk" FOREIGN KEY ("memo_id") REFERENCES "public"."research_memos"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_collection_items_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade,
  ADD CONSTRAINT "research_collection_items_added_by_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null;

ALTER TABLE "research_item_tags"
  ADD CONSTRAINT "research_item_tags_collection_item_id_fk" FOREIGN KEY ("collection_item_id") REFERENCES "public"."research_collection_items"("id") ON DELETE cascade;

CREATE INDEX "research_collections_user_updated_idx"
  ON "research_collections" USING btree ("user_id","deleted_at","updated_at" DESC NULLS LAST);
CREATE INDEX "research_collections_shared_idx"
  ON "research_collections" USING btree ("org_id","shared_with_org","deleted_at") WHERE "shared_with_org" = true;
CREATE INDEX "research_collections_case_idx"
  ON "research_collections" USING btree ("case_id") WHERE "case_id" IS NOT NULL;

CREATE UNIQUE INDEX "research_collection_items_unique_opinion"
  ON "research_collection_items" ("collection_id","opinion_id") WHERE "opinion_id" IS NOT NULL;
CREATE UNIQUE INDEX "research_collection_items_unique_statute"
  ON "research_collection_items" ("collection_id","statute_id") WHERE "statute_id" IS NOT NULL;
CREATE UNIQUE INDEX "research_collection_items_unique_memo"
  ON "research_collection_items" ("collection_id","memo_id") WHERE "memo_id" IS NOT NULL;
CREATE UNIQUE INDEX "research_collection_items_unique_session"
  ON "research_collection_items" ("collection_id","session_id") WHERE "session_id" IS NOT NULL;
CREATE INDEX "research_collection_items_collection_position_idx"
  ON "research_collection_items" USING btree ("collection_id","position");
CREATE INDEX "research_collection_items_opinion_idx"
  ON "research_collection_items" USING btree ("opinion_id") WHERE "opinion_id" IS NOT NULL;
CREATE INDEX "research_collection_items_statute_idx"
  ON "research_collection_items" USING btree ("statute_id") WHERE "statute_id" IS NOT NULL;
CREATE INDEX "research_collection_items_memo_idx"
  ON "research_collection_items" USING btree ("memo_id") WHERE "memo_id" IS NOT NULL;
CREATE INDEX "research_collection_items_session_idx"
  ON "research_collection_items" USING btree ("session_id") WHERE "session_id" IS NOT NULL;

CREATE UNIQUE INDEX "research_item_tags_item_tag_unique"
  ON "research_item_tags" USING btree ("collection_item_id","tag");
CREATE INDEX "research_item_tags_tag_idx"
  ON "research_item_tags" USING btree ("tag","collection_item_id");
