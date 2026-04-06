# Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-way calendar sync from ClearTerms → Google Calendar, Outlook, and iCal feed so lawyers see deadlines in their preferred calendar app.

**Architecture:** Standalone OAuth flows for Google/Outlook store encrypted tokens in `calendar_connections`. Inngest functions handle realtime push + periodic sweep. Provider adapter pattern abstracts Google/Outlook behind a unified interface. iCal feed is a separate public endpoint with its own preferences table.

**Tech Stack:** googleapis, @microsoft/microsoft-graph-client, ical-generator, Inngest v4, Drizzle ORM, AES-256-GCM (node:crypto), tRPC 11, Next.js 16 API routes

**Spec:** `docs/superpowers/specs/2026-04-05-calendar-sync-design.md`

**Important conventions:**
- **date-fns v4:** Always `import { fn } from "date-fns"`. Subpath imports like `"date-fns/addMonths"` do not exist in v4.
- **Migrations:** Must be hand-written. No `drizzle-kit generate` (no journal baseline in repo).
- **Env vars:** All new env vars must be added to `src/lib/env.ts` Zod schema (validated at startup).
- **Commits:** Commit after every task. Never use `git add -A` — always stage specific files to avoid committing `.env.local`.

---

## Chunk 1: Data Layer (Schema + Migration + Crypto + Env)

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install googleapis, graph client, ical-generator**

```bash
pnpm add googleapis @microsoft/microsoft-graph-client ical-generator
```

- [ ] **Step 2: Verify install**

```bash
pnpm tsc --noEmit 2>&1 | head -5
```

Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add googleapis, microsoft-graph-client, ical-generator for 2.1.3b"
```

---

### Task 2: Add env vars to validation schema

**Files:**
- Modify: `src/lib/env.ts`

Read `src/lib/env.ts` first to see current schema.

- [ ] **Step 1: Add new env vars to envSchema**

Add inside `z.object({})`:

```typescript
// Calendar sync (2.1.3b)
CALENDAR_ENCRYPTION_KEY: z.string().length(64),
CALENDAR_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
CALENDAR_ENCRYPTION_KEY_PREV: z.string().length(64).optional(),
GOOGLE_CLIENT_ID: z.string().min(1),
GOOGLE_CLIENT_SECRET: z.string().min(1),
MICROSOFT_CLIENT_ID: z.string().min(1),
MICROSOFT_CLIENT_SECRET: z.string().min(1),
```

- [ ] **Step 2: Add placeholder values to `.env.local`**

```
CALENDAR_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
CALENDAR_ENCRYPTION_KEY_VERSION=1
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(env): add calendar sync env vars with Zod validation"
```

---

### Task 3: Crypto module — encrypt/decrypt with key versioning

**Files:**
- Create: `src/server/lib/crypto.ts`
- Create: `tests/unit/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/crypto.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt } from "@/server/lib/crypto";

describe("crypto", () => {
  // Set test key (64 hex chars = 32 bytes)
  const TEST_KEY = "a".repeat(64); // 64 hex chars

  beforeEach(() => {
    process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY;
    process.env.CALENDAR_ENCRYPTION_KEY_VERSION = "1";
    delete process.env.CALENDAR_ENCRYPTION_KEY_PREV;
  });

  afterEach(() => {
    // Always restore to prevent env leaks between tests
    process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY;
    process.env.CALENDAR_ENCRYPTION_KEY_VERSION = "1";
    delete process.env.CALENDAR_ENCRYPTION_KEY_PREV;
  });

  it("encrypts and decrypts a string", () => {
    const plaintext = "sk_live_test_token_12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":"); // version:iv:ciphertext:tag format
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same_token";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it("decrypts with previous key version", () => {
    // Encrypt with current key (version 1)
    const plaintext = "refresh_token_xyz";
    const encrypted = encrypt(plaintext);
    expect(encrypted.startsWith("1:")).toBe(true);

    // Rotate: current key becomes prev, new key becomes current
    const prevKey = TEST_KEY;
    const newKey = "b".repeat(64);
    process.env.CALENDAR_ENCRYPTION_KEY_PREV = prevKey;
    process.env.CALENDAR_ENCRYPTION_KEY = newKey;
    process.env.CALENDAR_ENCRYPTION_KEY_VERSION = "2";

    // Old ciphertext (version 1) should still decrypt using prev key
    expect(decrypt(encrypted)).toBe(plaintext);

    // New encryptions use version 2
    const newEncrypted = encrypt("new_token");
    expect(newEncrypted.startsWith("2:")).toBe(true);
    expect(decrypt(newEncrypted)).toBe("new_token");
    // afterEach handles env restoration
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("secret");
    const parts = encrypted.split(":");
    parts[2] = "ff" + parts[2].slice(2); // tamper ciphertext
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
pnpm vitest run tests/unit/crypto.test.ts
```

- [ ] **Step 3: Implement crypto module**

```typescript
// src/server/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(version: number): Buffer {
  const currentVersion = Number(process.env.CALENDAR_ENCRYPTION_KEY_VERSION ?? "1");
  if (version === currentVersion) {
    return Buffer.from(process.env.CALENDAR_ENCRYPTION_KEY!, "hex");
  }
  if (version === currentVersion - 1 && process.env.CALENDAR_ENCRYPTION_KEY_PREV) {
    return Buffer.from(process.env.CALENDAR_ENCRYPTION_KEY_PREV, "hex");
  }
  throw new Error(`No key available for encryption key version ${version}`);
}

export function encrypt(plaintext: string): string {
  const version = Number(process.env.CALENDAR_ENCRYPTION_KEY_VERSION ?? "1");
  const key = getKey(version);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${version}:${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decrypt(encrypted: string): string {
  const [versionStr, ivHex, ciphertextHex, authTagHex] = encrypted.split(":");
  const version = Number(versionStr);
  const key = getKey(version);
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm vitest run tests/unit/crypto.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/crypto.ts tests/unit/crypto.test.ts
git commit -m "feat(crypto): AES-256-GCM encrypt/decrypt with key versioning"
```

---

### Task 4: Drizzle schemas — calendar_connections, ical_feeds, preferences, sync_log

**Files:**
- Create: `src/server/db/schema/calendar-connections.ts`
- Create: `src/server/db/schema/ical-feeds.ts`
- Create: `src/server/db/schema/calendar-sync-preferences.ts`
- Create: `src/server/db/schema/ical-feed-preferences.ts`
- Create: `src/server/db/schema/calendar-sync-log.ts`
- Create: `tests/unit/calendar-sync-schema.test.ts`

Follow the pattern in `src/server/db/schema/case-calendar-events.ts`: `pgEnum` → `pgTable` with FK refs → indexes → `$inferSelect`/`$inferInsert` exports.

- [ ] **Step 1: Write schema smoke test**

```typescript
// tests/unit/calendar-sync-schema.test.ts
import { describe, it, expect } from "vitest";

describe("calendar sync schemas", () => {
  it("imports calendar_connections schema", async () => {
    const mod = await import("@/server/db/schema/calendar-connections");
    expect(mod.calendarConnections).toBeDefined();
    expect(mod.calendarProviderEnum).toBeDefined();
  });

  it("imports ical_feeds schema", async () => {
    const mod = await import("@/server/db/schema/ical-feeds");
    expect(mod.icalFeeds).toBeDefined();
  });

  it("imports calendar_sync_preferences schema", async () => {
    const mod = await import("@/server/db/schema/calendar-sync-preferences");
    expect(mod.calendarSyncPreferences).toBeDefined();
  });

  it("imports ical_feed_preferences schema", async () => {
    const mod = await import("@/server/db/schema/ical-feed-preferences");
    expect(mod.icalFeedPreferences).toBeDefined();
  });

  it("imports calendar_sync_log schema", async () => {
    const mod = await import("@/server/db/schema/calendar-sync-log");
    expect(mod.calendarSyncLog).toBeDefined();
    expect(mod.syncStatusEnum).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm vitest run tests/unit/calendar-sync-schema.test.ts
```

- [ ] **Step 3: Create `calendar-connections.ts`**

```typescript
// src/server/db/schema/calendar-connections.ts
import { pgTable, uuid, text, boolean, timestamp, integer, unique, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";

export const calendarProviderEnum = pgEnum("calendar_provider", ["google", "outlook"]);
export type CalendarProvider = (typeof calendarProviderEnum.enumValues)[number];

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    provider: calendarProviderEnum("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    providerEmail: text("provider_email"),
    externalCalendarId: text("external_calendar_id"),
    scope: text("scope"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(),
    syncEnabled: boolean("sync_enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("calendar_connections_user_provider_unique").on(t.userId, t.provider),
  ],
);

export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type NewCalendarConnection = typeof calendarConnections.$inferInsert;
```

- [ ] **Step 4: Create `ical-feeds.ts`**

```typescript
// src/server/db/schema/ical-feeds.ts
import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const icalFeeds = pgTable("ical_feeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull().unique(),
  token: text("token").notNull().unique(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type IcalFeed = typeof icalFeeds.$inferSelect;
export type NewIcalFeed = typeof icalFeeds.$inferInsert;
```

- [ ] **Step 5: Create `calendar-sync-preferences.ts`**

```typescript
// src/server/db/schema/calendar-sync-preferences.ts
import { pgTable, uuid, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections";
import { cases } from "./cases";

export const calendarSyncPreferences = pgTable(
  "calendar_sync_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").references(() => calendarConnections.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    kinds: jsonb("kinds").$type<string[]>().default(["court_date", "filing_deadline", "meeting", "reminder", "other"]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("calendar_sync_preferences_connection_case_unique").on(t.connectionId, t.caseId),
  ],
);

export type CalendarSyncPreference = typeof calendarSyncPreferences.$inferSelect;
export type NewCalendarSyncPreference = typeof calendarSyncPreferences.$inferInsert;
```

- [ ] **Step 6: Create `ical-feed-preferences.ts`**

```typescript
// src/server/db/schema/ical-feed-preferences.ts
import { pgTable, uuid, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { icalFeeds } from "./ical-feeds";
import { cases } from "./cases";

export const icalFeedPreferences = pgTable(
  "ical_feed_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedId: uuid("feed_id").references(() => icalFeeds.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    kinds: jsonb("kinds").$type<string[]>().default(["court_date", "filing_deadline", "meeting", "reminder", "other"]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("ical_feed_preferences_feed_case_unique").on(t.feedId, t.caseId),
  ],
);

export type IcalFeedPreference = typeof icalFeedPreferences.$inferSelect;
export type NewIcalFeedPreference = typeof icalFeedPreferences.$inferInsert;
```

- [ ] **Step 7: Create `calendar-sync-log.ts`**

```typescript
// src/server/db/schema/calendar-sync-log.ts
import { pgTable, uuid, text, timestamp, integer, unique, index, pgEnum } from "drizzle-orm/pg-core";
import { caseCalendarEvents } from "./case-calendar-events";
import { calendarConnections } from "./calendar-connections";
import { sql } from "drizzle-orm";

export const syncStatusEnum = pgEnum("sync_status", ["pending", "synced", "failed"]);
export type SyncStatus = (typeof syncStatusEnum.enumValues)[number];

export const calendarSyncLog = pgTable(
  "calendar_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => caseCalendarEvents.id, { onDelete: "cascade" }).notNull(),
    connectionId: uuid("connection_id").references(() => calendarConnections.id, { onDelete: "cascade" }).notNull(),
    externalEventId: text("external_event_id"),
    status: syncStatusEnum("status").notNull().default("pending"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("calendar_sync_log_event_connection_unique").on(t.eventId, t.connectionId),
    index("idx_sync_log_pending").on(t.status, t.retryCount).where(sql`status IN ('pending', 'failed')`),
    index("idx_sync_log_connection").on(t.connectionId),
  ],
);

export type CalendarSyncLogEntry = typeof calendarSyncLog.$inferSelect;
export type NewCalendarSyncLogEntry = typeof calendarSyncLog.$inferInsert;
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
pnpm vitest run tests/unit/calendar-sync-schema.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/server/db/schema/calendar-connections.ts src/server/db/schema/ical-feeds.ts src/server/db/schema/calendar-sync-preferences.ts src/server/db/schema/ical-feed-preferences.ts src/server/db/schema/calendar-sync-log.ts tests/unit/calendar-sync-schema.test.ts
git commit -m "feat(db): add calendar sync schemas — connections, feeds, preferences, sync log"
```

---

### Task 5: Hand-written migration 0003

**Files:**
- Create: `src/server/db/migrations/0003_calendar_sync.sql`

Follow the pattern in `0002_case_calendar_events.sql`. Hand-written, no drizzle-kit generate.

- [ ] **Step 1: Write migration SQL**

Read `src/server/db/migrations/0002_case_calendar_events.sql` for the exact style, then create:

```sql
-- 0003_calendar_sync.sql
-- Hand-written migration for 2.1.3b Calendar Sync.
-- Creates tables: calendar_connections, ical_feeds, calendar_sync_preferences,
-- ical_feed_preferences, calendar_sync_log, and enums: calendar_provider, sync_status.
-- Must be hand-written (no drizzle-kit journal baseline in this repo).

-- Enums
CREATE TYPE "public"."calendar_provider" AS ENUM ('google', 'outlook');
CREATE TYPE "public"."sync_status" AS ENUM ('pending', 'synced', 'failed');

-- calendar_connections
CREATE TABLE IF NOT EXISTS "public"."calendar_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "provider" "public"."calendar_provider" NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "provider_email" text,
  "external_calendar_id" text,
  "scope" text,
  "token_expires_at" timestamp with time zone,
  "encryption_key_version" integer NOT NULL DEFAULT 1,
  "sync_enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_connections_user_provider_unique" UNIQUE ("user_id", "provider")
);

ALTER TABLE "public"."calendar_connections"
  ADD CONSTRAINT "calendar_connections_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION;

-- ical_feeds
CREATE TABLE IF NOT EXISTS "public"."ical_feeds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL UNIQUE,
  "token" text NOT NULL UNIQUE,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "public"."ical_feeds"
  ADD CONSTRAINT "ical_feeds_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION;

-- calendar_sync_preferences
CREATE TABLE IF NOT EXISTS "public"."calendar_sync_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "kinds" jsonb NOT NULL DEFAULT '["court_date","filing_deadline","meeting","reminder","other"]',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_sync_preferences_connection_case_unique" UNIQUE ("connection_id", "case_id")
);

ALTER TABLE "public"."calendar_sync_preferences"
  ADD CONSTRAINT "calendar_sync_preferences_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE CASCADE;
ALTER TABLE "public"."calendar_sync_preferences"
  ADD CONSTRAINT "calendar_sync_preferences_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;

-- ical_feed_preferences
CREATE TABLE IF NOT EXISTS "public"."ical_feed_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "feed_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "kinds" jsonb NOT NULL DEFAULT '["court_date","filing_deadline","meeting","reminder","other"]',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ical_feed_preferences_feed_case_unique" UNIQUE ("feed_id", "case_id")
);

ALTER TABLE "public"."ical_feed_preferences"
  ADD CONSTRAINT "ical_feed_preferences_feed_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."ical_feeds"("id") ON DELETE CASCADE;
ALTER TABLE "public"."ical_feed_preferences"
  ADD CONSTRAINT "ical_feed_preferences_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;

-- calendar_sync_log
CREATE TABLE IF NOT EXISTS "public"."calendar_sync_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "external_event_id" text,
  "status" "public"."sync_status" NOT NULL DEFAULT 'pending',
  "last_attempt_at" timestamp with time zone,
  "error_message" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_sync_log_event_connection_unique" UNIQUE ("event_id", "connection_id")
);

ALTER TABLE "public"."calendar_sync_log"
  ADD CONSTRAINT "calendar_sync_log_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."case_calendar_events"("id") ON DELETE CASCADE;
ALTER TABLE "public"."calendar_sync_log"
  ADD CONSTRAINT "calendar_sync_log_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE CASCADE;

-- Indexes for sync_log
CREATE INDEX "idx_sync_log_pending" ON "public"."calendar_sync_log" ("status", "retry_count") WHERE status IN ('pending', 'failed');
CREATE INDEX "idx_sync_log_connection" ON "public"."calendar_sync_log" ("connection_id");
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/migrations/0003_calendar_sync.sql
git commit -m "feat(db): migration 0003 — calendar sync tables (hand-written)"
```

---

## Chunk 2: Provider Adapters + iCal Generator

### Task 6: CalendarProvider interface and ExternalEvent type

**Files:**
- Create: `src/server/lib/calendar-providers/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/server/lib/calendar-providers/types.ts
export interface ExternalEvent {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt?: Date; // null/undefined = all-day event
  location?: string;
}

export interface CalendarProvider {
  createCalendar(name: string): Promise<{ calendarId: string }>;
  deleteCalendar(calendarId: string): Promise<void>;
  createEvent(calendarId: string, event: ExternalEvent): Promise<{ externalEventId: string }>;
  updateEvent(calendarId: string, externalEventId: string, event: ExternalEvent): Promise<void>;
  deleteEvent(calendarId: string, externalEventId: string): Promise<void>;
  refreshToken(): Promise<{ accessToken: string; expiresAt: Date }>;
  revokeToken(): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/lib/calendar-providers/types.ts
git commit -m "feat(providers): CalendarProvider interface and ExternalEvent type"
```

---

### Task 7: Google Calendar adapter

**Files:**
- Create: `src/server/lib/calendar-providers/google.ts`
- Create: `tests/unit/google-calendar-provider.test.ts`

- [ ] **Step 1: Write tests for event mapping**

```typescript
// tests/unit/google-calendar-provider.test.ts
import { describe, it, expect } from "vitest";
import { mapToGoogleEvent } from "@/server/lib/calendar-providers/google";

describe("GoogleCalendarProvider mapping", () => {
  it("maps timed event to Google format", () => {
    const result = mapToGoogleEvent({
      title: "Court Hearing",
      description: "Smith v. Jones",
      startsAt: new Date("2026-04-22T09:00:00Z"),
      endsAt: new Date("2026-04-22T10:00:00Z"),
      location: "District Court, Room 4B",
    }, "https://app.clearterms.com/cases/abc");

    expect(result.summary).toBe("Court Hearing");
    expect(result.start?.dateTime).toBe("2026-04-22T09:00:00.000Z");
    expect(result.end?.dateTime).toBe("2026-04-22T10:00:00.000Z");
    expect(result.location).toBe("District Court, Room 4B");
    expect(result.description).toContain("Smith v. Jones");
    expect(result.description).toContain("Managed by ClearTerms");
    expect(result.description).toContain("https://app.clearterms.com/cases/abc");
  });

  it("maps all-day event (endsAt null) to Google date format", () => {
    const result = mapToGoogleEvent({
      title: "Filing Deadline",
      startsAt: new Date("2026-04-22T00:00:00Z"),
    }, "https://app.clearterms.com/cases/abc");

    expect(result.start?.date).toBe("2026-04-22");
    expect(result.end?.date).toBe("2026-04-23"); // next day per RFC
    expect(result.start?.dateTime).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm vitest run tests/unit/google-calendar-provider.test.ts
```

- [ ] **Step 3: Implement Google adapter**

Read googleapis docs via Context7 for `google.calendar("v3")` API before implementing. Create the adapter implementing `CalendarProvider` interface. Export `mapToGoogleEvent` for testability.

Key implementation points:
- Constructor takes `accessToken`, `refreshToken`, `clientId`, `clientSecret`
- Use `google.auth.OAuth2` for auth
- `createCalendar` → `calendar.calendars.insert({ summary: name })`
- `createEvent` → `calendar.events.insert({ calendarId, requestBody: mappedEvent })`
- `updateEvent` → `calendar.events.update({ calendarId, eventId, requestBody })`
- `deleteEvent` → `calendar.events.delete({ calendarId, eventId })`
- `refreshToken` → `oauth2Client.refreshAccessToken()`
- `revokeToken` → `oauth2Client.revokeToken(token)`
- All-day: use `{ date: "YYYY-MM-DD" }` instead of `{ dateTime: "..." }`
- Description footer: `"\n\nManaged by ClearTerms\nView in ClearTerms: {caseUrl}"`

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm vitest run tests/unit/google-calendar-provider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/calendar-providers/google.ts tests/unit/google-calendar-provider.test.ts
git commit -m "feat(providers): Google Calendar adapter with event mapping"
```

---

### Task 8: Outlook Calendar adapter

**Files:**
- Create: `src/server/lib/calendar-providers/outlook.ts`
- Create: `tests/unit/outlook-calendar-provider.test.ts`

- [ ] **Step 1: Write tests for event mapping**

```typescript
// tests/unit/outlook-calendar-provider.test.ts
import { describe, it, expect } from "vitest";
import { mapToOutlookEvent } from "@/server/lib/calendar-providers/outlook";

describe("OutlookCalendarProvider mapping", () => {
  it("maps timed event to Outlook/Graph format", () => {
    const result = mapToOutlookEvent({
      title: "Client Meeting",
      description: "Discuss settlement",
      startsAt: new Date("2026-04-22T14:00:00Z"),
      endsAt: new Date("2026-04-22T15:00:00Z"),
      location: "Office",
    }, "https://app.clearterms.com/cases/xyz");

    expect(result.subject).toBe("Client Meeting");
    expect(result.start?.dateTime).toBe("2026-04-22T14:00:00.000Z");
    expect(result.start?.timeZone).toBe("UTC");
    expect(result.end?.dateTime).toBe("2026-04-22T15:00:00.000Z");
    expect(result.location?.displayName).toBe("Office");
    expect(result.body?.content).toContain("Discuss settlement");
    expect(result.body?.content).toContain("Managed by ClearTerms");
    expect(result.isAllDay).toBe(false);
  });

  it("maps all-day event to Outlook format", () => {
    const result = mapToOutlookEvent({
      title: "Filing Deadline",
      startsAt: new Date("2026-04-22T00:00:00Z"),
    }, "https://app.clearterms.com/cases/xyz");

    expect(result.isAllDay).toBe(true);
    expect(result.start?.dateTime).toBe("2026-04-22T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm vitest run tests/unit/outlook-calendar-provider.test.ts
```

- [ ] **Step 3: Implement Outlook adapter**

Read Microsoft Graph Calendar API docs via Context7 before implementing. Use `@microsoft/microsoft-graph-client` with `Client.initWithMiddleware()`.

Key implementation points:
- Constructor takes `accessToken`, `refreshToken`, `clientId`, `clientSecret`
- `createCalendar` → `client.api("/me/calendars").post({ name })`
- `createEvent` → `client.api("/me/calendars/{id}/events").post(mappedEvent)`
- `updateEvent` → `client.api("/me/calendars/{id}/events/{eventId}").patch(mappedEvent)`
- `deleteEvent` → `client.api("/me/calendars/{id}/events/{eventId}").delete()`
- `refreshToken` → POST to `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- `revokeToken` → No direct revoke API; skip gracefully
- All-day: `isAllDay: true`
- Outlook uses `body.contentType: "text"` for plain text descriptions

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm vitest run tests/unit/outlook-calendar-provider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/calendar-providers/outlook.ts tests/unit/outlook-calendar-provider.test.ts
git commit -m "feat(providers): Outlook Calendar adapter with event mapping"
```

---

### Task 9: Provider factory

**Files:**
- Create: `src/server/lib/calendar-providers/factory.ts`

- [ ] **Step 1: Create factory**

```typescript
// src/server/lib/calendar-providers/factory.ts
import type { CalendarProvider } from "./types";
import type { CalendarConnection } from "@/server/db/schema/calendar-connections";
import { GoogleCalendarProvider } from "./google";
import { OutlookCalendarProvider } from "./outlook";
import { decrypt } from "@/server/lib/crypto";
import { getEnv } from "@/lib/env";

export function getProvider(connection: CalendarConnection): CalendarProvider {
  const accessToken = decrypt(connection.accessToken);
  const refreshToken = decrypt(connection.refreshToken);
  const env = getEnv();

  switch (connection.provider) {
    case "google":
      return new GoogleCalendarProvider(
        accessToken,
        refreshToken,
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
      );
    case "outlook":
      return new OutlookCalendarProvider(
        accessToken,
        refreshToken,
        env.MICROSOFT_CLIENT_ID,
        env.MICROSOFT_CLIENT_SECRET,
      );
    default:
      throw new Error(`Unknown provider: ${connection.provider}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/lib/calendar-providers/factory.ts
git commit -m "feat(providers): factory — getProvider() dispatches by connection.provider"
```

---

### Task 10: iCal feed generator

**Files:**
- Create: `src/server/lib/ical-generator.ts`
- Create: `tests/unit/ical-generator.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/unit/ical-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateIcalFeed } from "@/server/lib/ical-generator";

describe("iCal feed generator", () => {
  it("generates valid VCALENDAR with timed events", () => {
    const result = generateIcalFeed([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        title: "Court Hearing",
        startsAt: new Date("2026-04-22T09:00:00Z"),
        endsAt: new Date("2026-04-22T10:00:00Z"),
        description: "Smith v. Jones",
        location: "District Court",
        kind: "court_date",
        caseId: "abc-123",
      },
    ]);

    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).toContain("PRODID:-//ClearTerms//Calendar//EN");
    expect(result).toContain("BEGIN:VEVENT");
    expect(result).toContain("SUMMARY:Court Hearing");
    expect(result).toContain("LOCATION:District Court");
    expect(result).toContain("END:VEVENT");
    expect(result).toContain("END:VCALENDAR");
    expect(result).toContain("X-PUBLISHED-TTL:PT30M");
    // ical-generator emits X-PUBLISHED-TTL but NOT REFRESH-INTERVAL
    // Apple Calendar uses REFRESH-INTERVAL, so we add it manually
    expect(result).toContain("REFRESH-INTERVAL");
  });

  it("generates all-day event with VALUE=DATE format", () => {
    const result = generateIcalFeed([
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        title: "Filing Deadline",
        startsAt: new Date("2026-04-22T00:00:00Z"),
        endsAt: null,
        kind: "filing_deadline",
        caseId: "abc-123",
      },
    ]);

    // ical-generator handles all-day formatting
    expect(result).toContain("SUMMARY:Filing Deadline");
    expect(result).toContain("BEGIN:VEVENT");
  });

  it("returns empty calendar for no events", () => {
    const result = generateIcalFeed([]);
    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).toContain("END:VCALENDAR");
    expect(result).not.toContain("BEGIN:VEVENT");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm vitest run tests/unit/ical-generator.test.ts
```

- [ ] **Step 3: Implement generator**

Read `ical-generator` library docs via Context7 for API usage.

```typescript
// src/server/lib/ical-generator.ts
import ical, { ICalCalendarMethod } from "ical-generator";

interface IcalEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  description?: string | null;
  location?: string | null;
  kind: string;
  caseId: string;
}

export function generateIcalFeed(events: IcalEvent[]): string {
  const calendar = ical({
    name: "ClearTerms",
    prodId: { company: "ClearTerms", product: "Calendar" },
    ttl: 30 * 60, // 30 minutes in seconds
  });

  for (const event of events) {
    const isAllDay = !event.endsAt;
    calendar.createEvent({
      id: `${event.id}@clearterms.app`,
      summary: event.title,
      start: event.startsAt,
      ...(isAllDay
        ? { allDay: true }
        : { end: event.endsAt! }),
      description: [
        event.description,
        "",
        `Kind: ${event.kind}`,
        "Managed by ClearTerms",
      ].filter((s) => s != null).join("\n"),
      location: event.location ?? undefined,
    });
  }

  // ical-generator emits X-PUBLISHED-TTL but not REFRESH-INTERVAL (used by Apple Calendar)
  // Manually inject REFRESH-INTERVAL;VALUE=DURATION:PT30M after the PRODID line
  const raw = calendar.toString();
  return raw.replace(
    "X-PUBLISHED-TTL:PT30M",
    "X-PUBLISHED-TTL:PT30M\r\nREFRESH-INTERVAL;VALUE=DURATION:PT30M",
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm vitest run tests/unit/ical-generator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/ical-generator.ts tests/unit/ical-generator.test.ts
git commit -m "feat(ical): iCal feed generator using ical-generator library"
```

---

## Chunk 3: tRPC Router + OAuth Routes + Middleware

### Task 11: calendarConnections tRPC router

**Files:**
- Create: `src/server/trpc/routers/calendar-connections.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create router with 6 procedures**

Read `src/server/trpc/routers/calendar.ts` for the exact pattern (imports, protectedProcedure, z.object input).

Implement procedures per spec:
- `list` — query: SELECT calendar_connections WHERE userId, join sync_log for aggregation. Return shape: `{ connection: CalendarConnection, lastSyncAt: Date | null, eventCount: number }[]` — use `MAX(calendar_sync_log.updatedAt)` for lastSyncAt and `COUNT(*)` for eventCount, grouped by connectionId.
- `getIcalFeed` — query: SELECT ical_feeds WHERE userId
- `updatePreferences` — mutation: upsert/delete calendar_sync_preferences rows. Validate `kinds` by importing `CALENDAR_EVENT_KINDS` from `@/lib/calendar-events` and using `z.array(z.enum(CALENDAR_EVENT_KINDS))` — single source of truth, no hardcoded duplicates.
- `regenerateIcalToken` — mutation: UPDATE ical_feeds SET token = crypto.randomUUID()
- `retrySyncEvent` — mutation: validate retryCount < 5, send `calendar/event.changed` via Inngest
- `getSyncStatus` — query: batch SELECT sync_log WHERE eventId IN (ids)

Also add a `disconnect` mutation:
- `disconnect` — mutation: per spec's revised disconnect order: (1) dispatch cleanup event first via `await inngest.send({ name: "calendar/connection.disconnected", data: { connectionId } })`, then (2) set `syncEnabled = false` on the connection. Order matters: dispatching the event first ensures the cleanup job is enqueued even if the process crashes before the DB update. The cleanup function (Task 19) handles external calendar deletion and DB row removal asynchronously.

- [ ] **Step 2: Register router in root.ts**

Add import and register as `calendarConnections: calendarConnectionsRouter` in `appRouter`.

- [ ] **Step 3: Run type check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/calendar-connections.ts src/server/trpc/root.ts
git commit -m "feat(trpc): calendarConnections router — list, preferences, ical, sync status"
```

---

### Task 12: Add inngest.send() to existing calendar router

**Files:**
- Modify: `src/server/trpc/routers/calendar.ts`

- [ ] **Step 1: Read current calendar.ts**

Read `src/server/trpc/routers/calendar.ts` to find exact locations of create, update, delete mutations.

- [ ] **Step 2: Add inngest import and send calls**

Add at top:
```typescript
import { inngest } from "@/server/inngest/client";
```

**Important:** Verify that `ctx.user.id` in the tRPC context is the internal DB UUID (not the Clerk ID). Check the tRPC context creation in the existing `calendar.ts` router. The `calendar_connections.userId` column stores the internal UUID, so the Inngest event must use the same ID.

In each mutation (create, update, delete), after the DB operation returns successfully but before the procedure returns, add:

```typescript
await inngest.send({
  name: "calendar/event.changed",
  data: { eventId: result.id, action: "create", userId: ctx.user.id },
});
```

(Substitute `"update"` and `"delete"` respectively, and use appropriate eventId variable.)

- [ ] **Step 3: Run type check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/calendar.ts
git commit -m "feat(calendar): dispatch inngest events on create/update/delete"
```

---

### Task 13: OAuth connect/callback routes — Google

**Files:**
- Create: `src/app/api/auth/google/connect/route.ts`
- Create: `src/app/api/auth/google/callback/route.ts`

- [ ] **Step 1: Read middleware.ts for public route pattern**

Read `src/middleware.ts` and `src/app/api/webhooks/clerk/route.ts` for API route patterns.

- [ ] **Step 2: Create connect route**

```typescript
// src/app/api/auth/google/connect/route.ts
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return new Response("Unauthorized", { status: 401 });

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, clerkUserId));
  if (!user) return new Response("User not found", { status: 401 });

  const env = getEnv();
  const state = randomUUID();

  const cookieStore = await cookies();
  cookieStore.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/auth",
  });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendars",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
```

- [ ] **Step 3: Create callback route**

Callback exchanges code for tokens, encrypts, inserts calendar_connections, creates sub-calendar, creates ical_feeds row. Read `src/server/lib/crypto.ts` encrypt function. Use googleapis SDK for token exchange and calendar creation.

**After inserting the `calendar_connections` row**, dispatch the backfill event:

```typescript
import { inngest } from "@/server/inngest/client";

// ... after db.insert(calendarConnections)...returning() ...
await inngest.send({
  name: "calendar/connection.created",
  data: { connectionId: connection.id, userId: user.id },
});
```

This triggers Task 18's `calendar.connection.init` function to backfill existing events.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/google/connect/route.ts src/app/api/auth/google/callback/route.ts
git commit -m "feat(oauth): Google Calendar connect + callback routes"
```

---

### Task 14: OAuth connect/callback routes — Outlook

**Files:**
- Create: `src/app/api/auth/outlook/connect/route.ts`
- Create: `src/app/api/auth/outlook/callback/route.ts`

- [ ] **Step 1: Create connect route**

Same pattern as Google, but using Microsoft OAuth endpoints:
- Auth URL: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Scopes: `Calendars.ReadWrite offline_access`

- [ ] **Step 2: Create callback route**

Token exchange URL: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
Then create sub-calendar via Graph API, encrypt tokens, insert calendar_connections.

**After inserting the `calendar_connections` row**, dispatch the backfill event (same as Task 13):

```typescript
await inngest.send({
  name: "calendar/connection.created",
  data: { connectionId: connection.id, userId: user.id },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/outlook/connect/route.ts src/app/api/auth/outlook/callback/route.ts
git commit -m "feat(oauth): Outlook Calendar connect + callback routes"
```

---

### Task 15: iCal feed endpoint + middleware allowlist

**Files:**
- Create: `src/app/api/ical/[token]/route.ts`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Add public routes to isPublicRoute in middleware.ts**

Read `src/middleware.ts`. Add these patterns to the `createRouteMatcher()` array:
- `"/api/ical(.*)"` — public iCal feed (token-authenticated, no Clerk session)
- `"/api/auth/google/callback"` — Google OAuth callback (provider redirects here without Clerk session)
- `"/api/auth/outlook/callback"` — Outlook OAuth callback (provider redirects here without Clerk session)

**Note:** Only the callback routes need to be public — the connect routes (`/api/auth/google/connect`, `/api/auth/outlook/connect`) call `auth()` internally and benefit from Clerk middleware protection. Use exact callback paths, NOT wildcards like `"/api/auth/google(.*)"`, to avoid accidentally making future routes under that prefix public.

- [ ] **Step 2: Create iCal route**

```typescript
// src/app/api/ical/[token]/route.ts
import { db } from "@/server/db";
import { icalFeeds } from "@/server/db/schema/ical-feeds";
import { icalFeedPreferences } from "@/server/db/schema/ical-feed-preferences";
import { caseCalendarEvents } from "@/server/db/schema/case-calendar-events";
import { eq, and, inArray, gte, lte } from "drizzle-orm";
import { generateIcalFeed } from "@/server/lib/ical-generator";
import { addMonths, subMonths } from "date-fns";

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 60; // requests per hour
const RATE_WINDOW = 3600_000; // 1 hour in ms

function isRateLimited(token: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(token) ?? []).filter((t) => now - t < RATE_WINDOW);
  if (timestamps.length >= RATE_LIMIT) return true;
  timestamps.push(now);
  rateLimitMap.set(token, timestamps);
  return false;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (isRateLimited(token)) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  const [feed] = await db.select().from(icalFeeds).where(eq(icalFeeds.token, token));
  if (!feed) return new Response("Not found", { status: 404 });
  if (!feed.enabled) return new Response("Feed disabled", { status: 403 });

  // Load preferences
  const prefs = await db.select().from(icalFeedPreferences).where(eq(icalFeedPreferences.feedId, feed.id));
  if (prefs.length === 0) {
    // No preferences = empty calendar
    const empty = generateIcalFeed([]);
    return new Response(empty, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-store, private",
      },
    });
  }

  // Load events within ±6 months filtered by preferences
  const now = new Date();
  const from = subMonths(now, 6);
  const to = addMonths(now, 6);
  const caseIds = prefs.map((p) => p.caseId);

  const events = await db
    .select()
    .from(caseCalendarEvents)
    .where(
      and(
        inArray(caseCalendarEvents.caseId, caseIds),
        gte(caseCalendarEvents.startsAt, from),
        lte(caseCalendarEvents.startsAt, to),
      ),
    );

  // Filter by kinds per case
  const prefMap = new Map(prefs.map((p) => [p.caseId, p.kinds as string[]]));
  const filtered = events.filter((e) => {
    const allowedKinds = prefMap.get(e.caseId);
    return allowedKinds?.includes(e.kind);
  });

  const ical = generateIcalFeed(
    filtered.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      description: e.description,
      location: e.location,
      kind: e.kind,
      caseId: e.caseId,
    })),
  );

  return new Response(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store, private",
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ical/[token]/route.ts src/middleware.ts
git commit -m "feat(ical): public feed endpoint + middleware allowlist"
```

---

## Chunk 4: Inngest Sync Functions

### Task 16: calendar.event.sync — realtime push

**Files:**
- Create: `src/server/inngest/functions/calendar-event-sync.ts`

- [ ] **Step 1: Create sync function**

Follow the pattern in `src/server/inngest/functions/extract-document.ts`.

```typescript
import { inngest } from "../client";
// ... implementation per spec: load connections, check preferences, call provider, upsert sync_log
```

Key steps:
1. `step.run("load-event")` — load the `case_calendar_events` row by eventId to get `caseId` and `kind` (needed for preference filtering). For delete actions, also load the `calendar_sync_log` rows to get `externalEventId` for each connection.
2. `step.run("load-connections")` — query calendar_connections for userId where syncEnabled=true
3. For each connection, `step.run("check-prefs-{connectionId}")` — check sync_preferences for caseId + kind match. If no matching preference row exists (opt-in model), skip this connection.
4. `step.run("push-{connectionId}")` — call `getProvider(connection).createEvent/updateEvent/deleteEvent`. For delete: use `externalEventId` from sync_log loaded in step 1.
5. `step.run("log-{connectionId}")` — upsert sync_log (set status to "synced" on success, "failed" on error)

Retries: `{ retries: 3 }` in function config.

**Step ID stability:** Inngest uses step IDs to track execution state across retries. The step ID strings (e.g., `"push-{connectionId}"`) MUST be deterministic and stable — use the actual connectionId UUID in the template, never a loop index. If step IDs change between retries, Inngest will re-execute already-completed steps.

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/calendar-event-sync.ts
git commit -m "feat(inngest): calendar.event.sync — realtime push to external calendars"
```

---

### Task 17: calendar.sweep — periodic safety net

**Files:**
- Create: `src/server/inngest/functions/calendar-sweep.ts`

- [ ] **Step 1: Create sweep cron function**

```typescript
import { inngest } from "../client";
// Trigger: { cron: "*/15 * * * *" }
// Query sync_log WHERE status IN ('pending','failed') AND retryCount < 5 LIMIT 200
// Group by connectionId, process sequentially with step.sleep between batches
// IMPORTANT: Every step.run and step.sleep inside loops MUST have unique, deterministic IDs:
//   step.run(`sync-${entry.id}`, ...) — use sync_log entry ID, never loop index
//   step.sleep(`sleep-after-${connectionId}`, "1s") — use connectionId for uniqueness
// Same step ID stability rules as Task 16 apply here.
```

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/calendar-sweep.ts
git commit -m "feat(inngest): calendar.sweep — 15-min cron safety net for failed syncs"
```

---

### Task 18: calendar.connection.init — initial backfill

**Files:**
- Create: `src/server/inngest/functions/calendar-connection-init.ts`

- [ ] **Step 1: Create backfill function**

```typescript
import { inngest } from "../client";
// Trigger: event "calendar/connection.created"
// Load events from user's cases, filter by calendar_sync_preferences (opt-in rows only),
// idempotency check on sync_log (skip if entry already exists for event+connection), bulk push.
//
// NOTE: On first connect, the calendar_sync_preferences table will be empty for this
// connection (user hasn't configured preferences yet). This means backfill correctly
// pushes zero events — this is expected behavior, NOT a bug. Events will sync as the
// user enables cases/kinds in the preferences UI.
```

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/calendar-connection-init.ts
git commit -m "feat(inngest): calendar.connection.init — backfill existing events on connect"
```

---

### Task 19: calendar.connection.cleanup — disconnect cleanup

**Files:**
- Create: `src/server/inngest/functions/calendar-connection-cleanup.ts`

- [ ] **Step 1: Create cleanup function**

```typescript
import { inngest } from "../client";
// Trigger: event "calendar/connection.disconnected"
// Fetch connection by ID, decrypt tokens, best-effort delete sub-calendar + revoke, then DELETE from DB
```

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/calendar-connection-cleanup.ts
git commit -m "feat(inngest): calendar.connection.cleanup — disconnect external cleanup"
```

---

### Task 20: Register all Inngest functions

**Files:**
- Modify: `src/server/inngest/index.ts`

- [ ] **Step 1: Add imports and register**

Read `src/server/inngest/index.ts`. Add 4 new imports and append to the `functions` array.

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/index.ts
git commit -m "chore(inngest): register 4 calendar sync functions"
```

---

## Chunk 5: UI — Settings Page + Sync Badges

### Task 21: Settings → Integrations page

**Files:**
- Create: `src/app/(app)/settings/integrations/page.tsx`

- [ ] **Step 1: Create integrations page**

Read existing UI components in `src/components/calendar/` and `src/components/ui/` for component patterns (shadcn/ui, lucide-react icons).

**Note:** The `calendar_connections` schema has no `email` column. The OAuth callback routes (Tasks 13/14) should save the user's provider email (fetched from the Google/Microsoft userinfo endpoint during token exchange) into a new `providerEmail` text column on `calendar_connections`. Add `providerEmail: text("provider_email")` to the schema (Task 4) and migration (Task 5) if not already present. The UI needs this to display "connected as user@gmail.com" on the card.

Build the page with:
- Provider cards (Google, Outlook, iCal) using the card layout from the design spec
- Connect/Disconnect buttons that link to OAuth routes (disconnect calls `trpc.calendarConnections.disconnect.useMutation()`)
- Expandable sync preferences section with kind chips + case checkboxes
- iCal URL display with Copy + Regenerate buttons
- Use `trpc.calendarConnections.list.useQuery()` for data
- Use `trpc.calendarConnections.updatePreferences.useMutation()` for auto-save
- Use `trpc.calendarConnections.regenerateIcalToken.useMutation()` for regenerate

- [ ] **Step 2: Add Settings nav entry to sidebar (if not exists)**

Check sidebar component. Add "Settings" / "Integrations" entry if needed.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/settings/integrations/page.tsx src/components/layout/sidebar.tsx
git commit -m "feat(ui): Settings → Integrations page with provider cards + sidebar nav"
```

(Include sidebar file only if modified in Step 2. Adjust path if sidebar lives elsewhere.)

---

### Task 22: Sync status badges on calendar event cards

**Files:**
- Modify: `src/components/calendar/calendar-event-card.tsx` (verify exact path with `ls src/components/calendar/`)

**Data-flow architecture:** react-big-calendar renders event cards via `components={{ event: CalendarEventCard }}`. The card receives `EventProps<RBCEvent>` — you CANNOT add custom props directly. Instead, use a closure pattern in `CalendarViewInner`:

1. In `CalendarViewInner`, batch-query sync status for all visible event IDs
2. Create the event component inside a `useMemo` that closes over the sync status data
3. Pass the closure component to react-big-calendar's `components` prop

The sync status data flows: `tRPC query → useMemo closure → CalendarEventCard render`.

Return type from `getSyncStatus`: use `Record<string, SyncLogEntry[]>` (not `Map` — Maps are not JSON-serializable over tRPC).

- [ ] **Step 1: Read calendar components**

Run `ls src/components/calendar/` to find the exact event card component and `CalendarViewInner`. Read both files to understand the current `components` prop wiring and `RBCEvent` type.

- [ ] **Step 2: Add sync status query to CalendarViewInner**

In `CalendarViewInner` (the component that renders `<Calendar components={...}>`), add the batch query:

```typescript
const eventIds = events.map((e) => e.id);
const { data: syncStatusMap } = trpc.calendarConnections.getSyncStatus.useQuery(
  { eventIds },
  { enabled: eventIds.length > 0 },
);

// Create event component that closes over syncStatusMap
const EventComponent = useMemo(
  () =>
    function CalendarEventCardWithSync(props: EventProps<RBCEvent>) {
      const statuses = syncStatusMap?.[props.event.resource?.id ?? ""] ?? [];
      return <CalendarEventCard {...props} syncStatuses={statuses} />;
    },
  [syncStatusMap],
);

// Pass to react-big-calendar: components={{ event: EventComponent, ... }}
```

- [ ] **Step 3: Add sync badge pills to event card**

Update `CalendarEventCard` to accept an optional `syncStatuses` prop alongside `EventProps<RBCEvent>`. Render badge pills below event title:
- Green pill: `G synced` (#166534 bg, #bbf7d0 text)
- Yellow pill: `G pending` (#854d0e bg, #fef08a text)
- Red pill: `G failed ↻` (#991b1b bg, #fecaca text) — clickable, calls `retrySyncEvent`

Event card backgrounds: `#1e293b`, titles: `#f1f5f9` font-weight 600.

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/calendar-event-card.tsx src/components/calendar/calendar-view-inner.tsx
git commit -m "feat(ui): sync status badge pills on calendar events"
```

---

## Chunk 6: Verification

### Task 23: Type check + test suite

- [ ] **Step 1: Run full type check**

```bash
pnpm tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm vitest run
```

All tests should pass. Fix any failures.

- [ ] **Step 3: Commit fixes if needed**

Stage only the specific files you modified (never `git add -A` — risks committing `.env.local`):

```bash
git add <list-specific-files-you-changed>
git commit -m "fix: resolve type/test issues from calendar sync integration"
```

---

### Task 24: UAT checklist

Manual verification per spec:

- [ ] 1. Google connect → OAuth consent → redirect back → connection visible in Settings
- [ ] 2. Sync preferences → enable case + select kinds → auto-save works
- [ ] 3. Create event in enabled case → sync badge shows "G pending" then "G synced"
- [ ] 4. Update event → synced event updates in Google Calendar
- [ ] 5. Delete event → event removed from Google Calendar
- [ ] 6. iCal feed → Copy URL → subscribe in calendar app → events visible
- [ ] 7. Regenerate iCal token → old URL stops working
- [ ] 8. Failed sync → red "G failed ↻" badge → click retry → re-syncs
- [ ] 9. Disconnect Google → background cleanup → connection removed from Settings
- [ ] 10. Outlook connect → same flow as Google but with Microsoft
- [ ] 11. Sidebar "Calendar" active state still works from 2.1.3a
- [ ] 12. iCal feed preferences → enable/disable cases + kinds → iCal URL reflects filtered events
- [ ] 13. Disconnect Google → iCal feed still works independently (iCal has its own token/preferences)
