-- Phase 2.1.7: Notifications
--
-- Adds notifications, notification_preferences, notification_mutes,
-- push_subscriptions, and notification_signals tables.
--
-- Dependencies: users, organizations, cases

-- notifications
CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid,
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "case_id" uuid,
  "action_url" text,
  "dedup_key" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "notifications_user_read_created_idx" ON "notifications" ("user_id", "is_read", "created_at" DESC);
CREATE INDEX "notifications_user_type_created_idx" ON "notifications" ("user_id", "type", "created_at" DESC);
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
CREATE UNIQUE INDEX "notifications_dedup_key_unique" ON "notifications" ("dedup_key") WHERE dedup_key IS NOT NULL;

-- notification_preferences
CREATE TABLE "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "notification_type" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true
);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "notification_prefs_user_type_channel_unique"
  ON "notification_preferences" ("user_id", "notification_type", "channel");

-- notification_mutes
CREATE TABLE "notification_mutes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "notification_mutes_user_case_unique"
  ON "notification_mutes" ("user_id", "case_id");

-- push_subscriptions
CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "push_subscriptions_endpoint_unique" ON "push_subscriptions" ("endpoint");
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

-- notification_signals
CREATE TABLE "notification_signals" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "last_signal_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "notification_signals" ADD CONSTRAINT "notification_signals_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

-- RLS policies (matching existing patterns from 0001_rls_policies.sql)
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notifications" ON "notifications"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_preferences" ON "notification_preferences"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "notification_mutes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_mutes" ON "notification_mutes"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_push_subscriptions" ON "push_subscriptions"
  FOR ALL USING (user_id = get_current_user_id());

ALTER TABLE "notification_signals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_signals" ON "notification_signals"
  FOR ALL USING (user_id = get_current_user_id());
