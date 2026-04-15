# Client Portal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-facing portal where law firm clients can view cases, exchange messages, download/upload documents, pay invoices via Stripe, and track tasks and calendar events.

**Architecture:** Separate `(portal)/` route group with own layout, own JWT auth (magic link via Resend), own tRPC procedures (`portalProcedure`). Data isolated by `clientId`. Notifications via separate `portal_notifications` table + SSE. Stripe Checkout for payments.

**Tech Stack:** Next.js, tRPC, Drizzle ORM, Supabase (Postgres), jose (JWT), Resend (email), Stripe, Inngest, SSE

**Spec:** `docs/superpowers/specs/2026-04-14-client-portal-design.md`

---

## Chunk 1: Foundation (DB + Auth + Middleware)

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jose and stripe**

```bash
npm install jose stripe
```

- [ ] **Step 2: Add PORTAL_JWT_SECRET to env.ts**

Modify `src/lib/env.ts` — add to envSchema (note: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` already exist in env.ts):
```typescript
PORTAL_JWT_SECRET: z.string().min(32),
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/lib/env.ts
git commit -m "chore: add jose and stripe dependencies for client portal"
```

---

### Task 2: Drizzle schemas for portal tables

**Files:**
- Create: `src/server/db/schema/portal-users.ts`
- Create: `src/server/db/schema/portal-sessions.ts`
- Create: `src/server/db/schema/portal-magic-links.ts`
- Create: `src/server/db/schema/case-messages.ts`
- Create: `src/server/db/schema/portal-notifications.ts`
- Create: `src/server/db/schema/portal-notification-preferences.ts`
- Modify: `src/server/db/index.ts`

- [ ] **Step 1: Create portal-users schema**

Create `src/server/db/schema/portal-users.ts`:
```typescript
import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients";
import { organizations } from "./organizations";
import { users } from "./users";

export const portalUsers = pgTable(
  "portal_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("portal_users_email_org_unique")
      .on(table.email, table.orgId)
      .where(sql`org_id IS NOT NULL`),
    uniqueIndex("portal_users_email_user_unique")
      .on(table.email, table.userId)
      .where(sql`user_id IS NOT NULL`),
    index("portal_users_client_idx").on(table.clientId),
    check("portal_users_scope_check", sql`(org_id IS NOT NULL) != (user_id IS NOT NULL)`),
  ],
);
```

- [ ] **Step 2: Create portal-sessions schema**

Create `src/server/db/schema/portal-sessions.ts`:
```typescript
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { portalUsers } from "./portal-users";

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portal_sessions_token_idx").on(table.token),
    index("portal_sessions_portal_user_idx").on(table.portalUserId),
  ],
);
```

- [ ] **Step 3: Create portal-magic-links schema**

Create `src/server/db/schema/portal-magic-links.ts`:
```typescript
import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { portalUsers } from "./portal-users";

export const portalMagicLinks = pgTable(
  "portal_magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portal_magic_links_user_used_idx").on(table.portalUserId, table.usedAt),
  ],
);
```

- [ ] **Step 4: Create case-messages schema**

Create `src/server/db/schema/case-messages.ts`:
```typescript
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { portalUsers } from "./portal-users";

export const caseMessages = pgTable(
  "case_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    authorType: text("author_type").notNull(),
    lawyerAuthorId: uuid("lawyer_author_id").references(() => users.id, { onDelete: "set null" }),
    portalAuthorId: uuid("portal_author_id").references(() => portalUsers.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("case_messages_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "case_messages_author_check",
      sql`(author_type = 'lawyer' AND lawyer_author_id IS NOT NULL AND portal_author_id IS NULL) OR (author_type = 'client' AND portal_author_id IS NOT NULL AND lawyer_author_id IS NULL)`,
    ),
  ],
);
```

- [ ] **Step 5: Create portal-notifications schema**

Create `src/server/db/schema/portal-notifications.ts`:
```typescript
import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portalUsers } from "./portal-users";
import { cases } from "./cases";

export const portalNotifications = pgTable(
  "portal_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    actionUrl: text("action_url"),
    isRead: boolean("is_read").default(false).notNull(),
    dedupKey: text("dedup_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portal_notif_user_read_created_idx").on(table.portalUserId, table.isRead, table.createdAt.desc()),
    uniqueIndex("portal_notif_dedup_key_unique")
      .on(table.dedupKey)
      .where(sql`dedup_key IS NOT NULL`),
  ],
);

export const portalNotificationSignals = pgTable(
  "portal_notification_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);
```

- [ ] **Step 6: Create portal-notification-preferences schema**

Create `src/server/db/schema/portal-notification-preferences.ts`:
```typescript
import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { portalUsers } from "./portal-users";

export const portalNotificationPreferences = pgTable(
  "portal_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portalUserId: uuid("portal_user_id")
      .references(() => portalUsers.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("portal_notif_pref_user_type_unique").on(table.portalUserId, table.type),
  ],
);
```

- [ ] **Step 7: Add portalVisibility to cases, uploadedByPortalUserId to documents, stripeCheckoutSessionId to invoices**

Modify `src/server/db/schema/cases.ts` — add column to the `cases` pgTable:
```typescript
portalVisibility: jsonb("portal_visibility").$type<{ documents: boolean; tasks: boolean; calendar: boolean; billing: boolean; messages: boolean }>().default({ documents: true, tasks: true, calendar: true, billing: true, messages: true }),
```
Import `jsonb` from `"drizzle-orm/pg-core"`.

Modify `src/server/db/schema/documents.ts` — add column:
```typescript
uploadedByPortalUserId: uuid("uploaded_by_portal_user_id"),
```
Note: Do NOT add FK reference to avoid circular dependency issues. Application-level integrity.

Modify `src/server/db/schema/invoices.ts` — add column:
```typescript
stripeCheckoutSessionId: text("stripe_checkout_session_id"),
```

- [ ] **Step 8: Register all new schemas in db/index.ts**

Modify `src/server/db/index.ts` — add imports:
```typescript
import * as portalUsersSchema from "./schema/portal-users";
import * as portalSessionsSchema from "./schema/portal-sessions";
import * as portalMagicLinksSchema from "./schema/portal-magic-links";
import * as caseMessagesSchema from "./schema/case-messages";
import * as portalNotificationsSchema from "./schema/portal-notifications";
import * as portalNotificationPreferencesSchema from "./schema/portal-notification-preferences";
```

Add to schema object:
```typescript
...portalUsersSchema,
...portalSessionsSchema,
...portalMagicLinksSchema,
...caseMessagesSchema,
...portalNotificationsSchema,
...portalNotificationPreferencesSchema,
```

- [ ] **Step 9: Generate and review migration**

```bash
npm run db:generate
```

Review the generated migration file. If Drizzle generates it correctly, rename to `0008_client_portal.sql`. If not, write manually based on the schemas. Verify CHECK constraints and partial unique indexes are included.

- [ ] **Step 10: Commit**

```bash
git add src/server/db/schema/ src/server/db/index.ts src/server/db/migrations/
git commit -m "feat(portal): add Drizzle schemas for 7 portal tables + 3 column additions"
```

---

### Task 3: Portal JWT service

**Files:**
- Create: `src/server/services/portal-auth.ts`

- [ ] **Step 1: Create portal-auth service**

Create `src/server/services/portal-auth.ts`:
```typescript
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomInt } from "crypto";

const getSecret = () => new TextEncoder().encode(process.env.PORTAL_JWT_SECRET!);

export interface PortalJwtPayload {
  sub: string; // portalUserId
  sessionId: string;
  clientId: string;
  orgId: string | null;
}

export async function signPortalJwt(payload: PortalJwtPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyPortalJwt(token: string): Promise<PortalJwtPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as PortalJwtPayload;
}

export function generateMagicCode(): { code: string; hash: string } {
  const code = String(randomInt(100000, 999999));
  const hash = createHash("sha256").update(code).digest("hex");
  return { code, hash };
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/portal-auth.ts
git commit -m "feat(portal): add JWT sign/verify and magic code helpers"
```

---

### Task 4: Portal middleware

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Add portal route interception before Clerk**

Modify `src/middleware.ts`. At the top of the exported middleware function, add early-return for `/portal` routes BEFORE `clerkMiddleware` runs:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

async function portalMiddleware(req: NextRequest) {
  const token = req.cookies.get("portal_token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/portal/login", req.url));
  }
  try {
    const secret = new TextEncoder().encode(process.env.PORTAL_JWT_SECRET!);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL("/portal/login", req.url));
    response.cookies.delete("portal_token");
    return response;
  }
}
```

> **Note (H6):** This middleware only checks JWT validity for performance — it does NOT verify the session exists in the DB. The real authorization check happens in `portalProcedure` (Task 5), which verifies the session is active and the portal user is enabled. This is by design: middleware runs on every request including static assets, while portalProcedure only runs on tRPC calls that access data.

Wrap the existing `clerkMiddleware` export:

```typescript
export default async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/portal")) {
    if (req.nextUrl.pathname.startsWith("/portal/login")) {
      return NextResponse.next();
    }
    return portalMiddleware(req);
  }
  // Existing clerk middleware
  return clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  })(req as any, {} as any);
}
```

Also add `/portal(.*)` to the matcher config so the middleware runs for portal routes:
The existing matcher already covers `/(api|trpc)(.*)` and the general catch-all, so `/portal` is already matched.

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(portal): add portal JWT middleware before Clerk"
```

---

### Task 5: portalProcedure for tRPC

**Files:**
- Modify: `src/server/trpc/trpc.ts`

- [ ] **Step 1: Add portalProcedure**

Modify `src/server/trpc/trpc.ts` — add after `protectedProcedure`:

```typescript
import { verifyPortalJwt } from "@/server/services/portal-auth";
import { portalUsers } from "@/server/db/schema/portal-users";
import { portalSessions } from "@/server/db/schema/portal-sessions";

const portalMiddleware = t.middleware(async ({ ctx, next }) => {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get("portal_token")?.value;

  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }

  let payload;
  try {
    payload = await verifyPortalJwt(token);
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid token" });
  }

  // Verify session is still valid
  const [session] = await db
    .select()
    .from(portalSessions)
    .where(and(
      eq(portalSessions.id, payload.sessionId),
      eq(portalSessions.portalUserId, payload.sub),
    ))
    .limit(1);

  if (!session || session.expiresAt < new Date()) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired" });
  }

  // Get portal user
  const [portalUser] = await db
    .select()
    .from(portalUsers)
    .where(and(
      eq(portalUsers.id, payload.sub),
      eq(portalUsers.status, "active"),
    ))
    .limit(1);

  if (!portalUser) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Account disabled" });
  }

  return next({
    ctx: {
      ...ctx,
      portalUser: {
        id: portalUser.id,
        email: portalUser.email,
        clientId: portalUser.clientId,
        orgId: portalUser.orgId,
        userId: portalUser.userId,
        displayName: portalUser.displayName,
      },
    },
  });
});

export const portalProcedure = t.procedure.use(portalMiddleware);
```

Export `portalProcedure` alongside `protectedProcedure`.

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/trpc.ts
git commit -m "feat(portal): add portalProcedure with JWT + session verification"
```

---

### Task 6: Portal auth router (sendCode, verifyCode, logout)

**Files:**
- Create: `src/server/trpc/routers/portal-auth.ts`
- Modify: `src/server/trpc/root.ts`
- Create: `src/server/services/portal-emails.ts`

- [ ] **Step 1: Create portal email templates**

Create `src/server/services/portal-emails.ts`:
```typescript
import { sendEmail } from "./email";

const PORTAL_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function sendPortalInviteEmail(to: string, displayName: string, orgName: string) {
  await sendEmail({
    to,
    subject: `You've been invited to ${orgName}'s Client Portal`,
    html: `
      <h1>Welcome, ${displayName}!</h1>
      <p>Your attorney has invited you to their client portal where you can view your cases, documents, and invoices.</p>
      <a href="${PORTAL_URL}/portal/login?email=${encodeURIComponent(to)}" style="display:inline-block;padding:12px 24px;background:#7c83ff;color:#fff;text-decoration:none;border-radius:6px;">Access Portal</a>
    `,
  });
}

export async function sendPortalCodeEmail(to: string, code: string) {
  await sendEmail({
    to,
    subject: `Your ClearTerms verification code: ${code}`,
    html: `
      <h1>Your verification code</h1>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;">${code}</p>
      <p>This code expires in 15 minutes.</p>
      <p>If you didn't request this code, you can safely ignore this email.</p>
    `,
  });
}
```

- [ ] **Step 2: Create portal-auth router**

Create `src/server/trpc/routers/portal-auth.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import { portalUsers } from "@/server/db/schema/portal-users";
import { portalMagicLinks } from "@/server/db/schema/portal-magic-links";
import { portalSessions } from "@/server/db/schema/portal-sessions";
import { generateMagicCode, hashCode, signPortalJwt, verifyPortalJwt } from "@/server/services/portal-auth";
import { sendPortalCodeEmail } from "@/server/services/portal-emails";

export const portalAuthRouter = router({
  sendCode: publicProcedure
    .input(z.object({ email: z.email() }))
    .mutation(async ({ ctx, input }) => {
      // May match multiple orgs — send codes to all active portal users with this email
      const matchingUsers = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(eq(portalUsers.email, input.email), eq(portalUsers.status, "active")));

      if (matchingUsers.length === 0) {
        // Don't reveal whether email exists
        return { success: true };
      }

      // Send a code for the first match (user selects org after verify if multiple)
      const user = matchingUsers[0]!;

      // Rate limit: max 3 codes in 15 min
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
      const [{ count }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(portalMagicLinks)
        .where(and(
          eq(portalMagicLinks.portalUserId, user.id),
          gt(portalMagicLinks.createdAt, fifteenMinAgo),
        ));

      if (count >= 3) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many code requests. Try again later." });
      }

      const { code, hash } = generateMagicCode();

      await ctx.db.insert(portalMagicLinks).values({
        portalUserId: user.id,
        codeHash: hash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      await sendPortalCodeEmail(input.email, code);
      return { success: true };
    }),

  verifyCode: publicProcedure
    .input(z.object({ email: z.email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(eq(portalUsers.email, input.email), eq(portalUsers.status, "active")))
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid code" });
      }

      // Find latest unused, unexpired magic link
      const [link] = await ctx.db
        .select()
        .from(portalMagicLinks)
        .where(and(
          eq(portalMagicLinks.portalUserId, user.id),
          isNull(portalMagicLinks.usedAt),
          gt(portalMagicLinks.expiresAt, new Date()),
        ))
        .orderBy(sql`created_at DESC`)
        .limit(1);

      if (!link) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired code" });
      }

      if (link.failedAttempts >= 5) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Request a new code." });
      }

      const inputHash = hashCode(input.code);
      if (inputHash !== link.codeHash) {
        await ctx.db
          .update(portalMagicLinks)
          .set({ failedAttempts: link.failedAttempts + 1 })
          .where(eq(portalMagicLinks.id, link.id));
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid code" });
      }

      // Mark used
      await ctx.db
        .update(portalMagicLinks)
        .set({ usedAt: new Date() })
        .where(eq(portalMagicLinks.id, link.id));

      // Create session
      const sessionId = crypto.randomUUID();
      await ctx.db.insert(portalSessions).values({
        id: sessionId,
        portalUserId: user.id,
        token: sessionId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const token = await signPortalJwt({
        sub: user.id,
        sessionId,
        clientId: user.clientId,
        orgId: user.orgId,
      });

      // Update lastLoginAt
      await ctx.db
        .update(portalUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(portalUsers.id, user.id));

      // Set cookie via response header (handled by caller)
      return { success: true, token };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const token = cookieStore.get("portal_token")?.value;

    if (token) {
      try {
        const payload = await verifyPortalJwt(token);
        await ctx.db
          .delete(portalSessions)
          .where(eq(portalSessions.id, payload.sessionId));
      } catch {
        // Token invalid — session already gone
      }
    }

    return { success: true };
  }),
});
```

- [ ] **Step 3: Register in root.ts**

Modify `src/server/trpc/root.ts`:
```typescript
import { portalAuthRouter } from "./routers/portal-auth";
// Add to router:
portalAuth: portalAuthRouter,
```

- [ ] **Step 4: Commit**

```bash
git add src/server/services/portal-emails.ts src/server/trpc/routers/portal-auth.ts src/server/trpc/root.ts
git commit -m "feat(portal): add portal auth router with sendCode, verifyCode, logout"
```

---

### Task 7: Portal login page

**Files:**
- Create: `src/app/(portal)/layout.tsx`
- Create: `src/app/(portal)/portal/login/page.tsx`
- Create: `src/components/portal/login-form.tsx`
- Create: `src/app/api/portal/set-token/route.ts`
- Create: `src/lib/portal-trpc.ts`

- [ ] **Step 1: Create portal tRPC client**

The portal needs its own tRPC setup that sends the `portal_token` cookie. However since both (app) and (portal) use the same Next.js app and same `AppRouter`, we can reuse the existing `trpc` client — cookies are sent automatically with same-origin requests.

No separate file needed — `src/lib/trpc.tsx` works for both.

- [ ] **Step 2: Create portal layout**

Create `src/app/(portal)/layout.tsx`:
```typescript
import { TRPCProvider } from "@/lib/trpc";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <TRPCProvider>{children}</TRPCProvider>;
}
```

Note: This is a minimal layout — the sidebar gets added in Task 13 after we have the portal shell component.

- [ ] **Step 3: Create set-token API route**

Create `src/app/api/portal/set-token/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set("portal_token", token, {
    path: "/portal",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 24 * 60 * 60,
  });
  return res;
}
```

- [ ] **Step 4: Create login form component**

Create `src/components/portal/login-form.tsx`:
```typescript
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PortalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState("");

  const sendCode = trpc.portalAuth.sendCode.useMutation({
    onSuccess: () => setStep("code"),
    onError: (err) => setError(err.message),
  });

  const verifyCode = trpc.portalAuth.verifyCode.useMutation({
    onSuccess: async (data) => {
      // Set cookie via API route to enable httpOnly
      await fetch("/api/portal/set-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token }),
      });
      router.push("/portal");
    },
    onError: (err) => setError(err.message),
  });

  return (
    <div className="mx-auto flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">ClearTerms</h1>
          <p className="text-sm text-zinc-500">Client Portal</p>
        </div>

        <div className="rounded-lg border bg-zinc-900 p-6">
          {step === "email" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                sendCode.mutate({ email });
              }}
              className="space-y-4"
            >
              <div className="text-left">
                <label className="text-xs text-zinc-400">Email address</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={sendCode.isPending}>
                {sendCode.isPending ? "Sending..." : "Send Code"}
              </Button>
              <p className="text-xs text-zinc-500">We'll send a 6-digit code to your email</p>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                verifyCode.mutate({ email, code });
              }}
              className="space-y-4"
            >
              <p className="text-sm text-zinc-400">
                Enter the code sent to <span className="text-white">{email}</span>
              </p>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="text-center text-2xl tracking-widest"
                required
              />
              <Button type="submit" className="w-full" disabled={verifyCode.isPending}>
                {verifyCode.isPending ? "Verifying..." : "Verify"}
              </Button>
              <button
                type="button"
                onClick={() => { setStep("email"); setCode(""); setError(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Use a different email
              </button>
            </form>
          )}

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create login page**

Create `src/app/(portal)/portal/login/page.tsx`:
```typescript
import { PortalLoginForm } from "@/components/portal/login-form";

export default function PortalLoginPage() {
  return <PortalLoginForm />;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(portal\)/ src/components/portal/login-form.tsx src/app/api/portal/set-token/
git commit -m "feat(portal): add portal layout and magic link login page"
```

---

## Chunk 2: Portal Routers (Cases, Documents, Messages)

### Task 8: portal-cases router

**Files:**
- Create: `src/server/trpc/routers/portal-cases.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create portal-cases router**

Create `src/server/trpc/routers/portal-cases.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { cases } from "@/server/db/schema/cases";

export const portalCasesRouter = router({
  list: portalProcedure
    .input(z.object({ cursor: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(cases.clientId, ctx.portalUser.clientId)];

      // Cursor-based pagination
      if (input?.cursor) {
        const [cursorRow] = await ctx.db
          .select({ createdAt: cases.createdAt })
          .from(cases)
          .where(eq(cases.id, input.cursor))
          .limit(1);
        if (cursorRow) {
          conditions.push(sql`${cases.createdAt} < ${cursorRow.createdAt}`);
        }
      }

      const rows = await ctx.db
        .select({
          id: cases.id,
          name: cases.name,
          status: cases.status,
          detectedCaseType: cases.detectedCaseType,
          portalVisibility: cases.portalVisibility,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
        })
        .from(cases)
        .where(and(...conditions))
        .orderBy(desc(cases.createdAt))
        .limit(21);

      return {
        cases: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),

  get: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(cases)
        .where(and(
          eq(cases.id, input.caseId),
          eq(cases.clientId, ctx.portalUser.clientId),
        ))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }

      return row;
    }),
});
```

Add missing import at top: `import { sql } from "drizzle-orm";`

- [ ] **Step 2: Register in root.ts**

Add to `src/server/trpc/root.ts`:
```typescript
import { portalCasesRouter } from "./routers/portal-cases";
// In router:
portalCases: portalCasesRouter,
```

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/portal-cases.ts src/server/trpc/root.ts
git commit -m "feat(portal): add portal-cases router with list and get"
```

---

### Task 9: portal-documents router

**Files:**
- Create: `src/server/trpc/routers/portal-documents.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create portal-documents router**

Create `src/server/trpc/routers/portal-documents.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc, sql, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { documents } from "@/server/db/schema/documents";
import { cases } from "@/server/db/schema/cases";
import { generatePresignedUrl } from "@/server/services/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function assertVisibility(portalVisibility: any, section: string) {
  const vis = portalVisibility as Record<string, boolean> | null;
  if (!vis || vis[section] === false) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Section not available" });
  }
}

export const portalDocumentsRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      cursor: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Verify case ownership + visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      assertVisibility(caseRow.portalVisibility, "documents");

      const conditions = [eq(documents.caseId, input.caseId), eq(documents.status, "ready")];

      const rows = await ctx.db
        .select({
          id: documents.id,
          filename: documents.filename,
          fileType: documents.fileType,
          fileSize: documents.fileSize,
          uploadedByPortalUserId: documents.uploadedByPortalUserId,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.createdAt))
        .limit(21);

      return {
        documents: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),

  getDownloadUrl: portalProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select({ id: documents.id, s3Key: documents.s3Key, caseId: documents.caseId })
        .from(documents)
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      // Verify case ownership
      const [caseRow] = await ctx.db
        .select({ clientId: cases.clientId })
        .from(cases)
        .where(eq(cases.id, doc.caseId!))
        .limit(1);
      if (!caseRow || caseRow.clientId !== ctx.portalUser.clientId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Generate presigned GET URL
      const { S3Client } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: doc.s3Key,
      });
      const url = await getSignedUrl(client, command, { expiresIn: 300 });
      return { url };
    }),

  upload: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      filename: z.string().min(1).max(255),
      fileType: z.enum(["pdf", "docx", "image"]),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify case ownership + visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, userId: cases.userId, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      assertVisibility(caseRow.portalVisibility, "documents");

      const contentTypeMap: Record<string, string> = {
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        image: "image/jpeg",
      };

      // Use case creator's userId for the NOT NULL userId column
      const { uploadUrl, s3Key } = await generatePresignedUrl(
        `portal/${ctx.portalUser.id}`,
        input.filename,
        contentTypeMap[input.fileType]!,
        25 * 1024 * 1024,
      );

      const [doc] = await ctx.db
        .insert(documents)
        .values({
          caseId: input.caseId,
          userId: caseRow.userId, // Case creator as owning attorney
          uploadedByPortalUserId: ctx.portalUser.id,
          s3Key,
          filename: input.filename,
          fileType: input.fileType,
          fileSize: 0, // Updated in confirmUpload after S3 upload completes
          checksumSha256: "", // Updated in confirmUpload after S3 upload completes
          status: "uploading",
        })
        .returning({ id: documents.id });

      return { uploadUrl, documentId: doc!.id };
    }),

  confirmUpload: portalProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select({ id: documents.id, caseId: documents.caseId, uploadedByPortalUserId: documents.uploadedByPortalUserId })
        .from(documents)
        .where(and(
          eq(documents.id, input.documentId),
          eq(documents.uploadedByPortalUserId, ctx.portalUser.id),
          eq(documents.status, "uploading"),
        ))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db
        .update(documents)
        .set({ status: "ready" })
        .where(eq(documents.id, doc.id));

      // TODO: Emit portal_document_uploaded notification to lawyer (Task 17)

      return { success: true };
    }),
});
```

- [ ] **Step 2: Register in root.ts**

Add to `src/server/trpc/root.ts`:
```typescript
import { portalDocumentsRouter } from "./routers/portal-documents";
portalDocuments: portalDocumentsRouter,
```

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/portal-documents.ts src/server/trpc/root.ts
git commit -m "feat(portal): add portal-documents router with list, download, upload, confirm"
```

---

### Task 10: portal-messages router

**Files:**
- Create: `src/server/trpc/routers/portal-messages.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create portal-messages router**

Create `src/server/trpc/routers/portal-messages.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { caseMessages } from "@/server/db/schema/case-messages";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { portalUsers } from "@/server/db/schema/portal-users";

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

export const portalMessagesRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      cursor: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(30),
    }))
    .query(async ({ ctx, input }) => {
      // Verify case ownership + messages visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      const vis = caseRow.portalVisibility as Record<string, boolean> | null;
      if (!vis || vis.messages === false) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Messages not available" });
      }

      const conditions = [
        eq(caseMessages.caseId, input.caseId),
        isNull(caseMessages.deletedAt),
      ];

      if (input.cursor) {
        const [cursorRow] = await ctx.db
          .select({ createdAt: caseMessages.createdAt })
          .from(caseMessages)
          .where(eq(caseMessages.id, input.cursor))
          .limit(1);
        if (cursorRow) {
          conditions.push(sql`${caseMessages.createdAt} < ${cursorRow.createdAt}`);
        }
      }

      const rows = await ctx.db
        .select({
          id: caseMessages.id,
          authorType: caseMessages.authorType,
          lawyerAuthorId: caseMessages.lawyerAuthorId,
          portalAuthorId: caseMessages.portalAuthorId,
          body: caseMessages.body,
          createdAt: caseMessages.createdAt,
        })
        .from(caseMessages)
        .where(and(...conditions))
        .orderBy(desc(caseMessages.createdAt))
        .limit(input.limit + 1);

      return {
        messages: rows.slice(0, input.limit),
        nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : undefined,
      };
    }),

  send: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      body: z.string().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify case ownership + messages visibility
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });

      const sanitizedBody = stripHtml(input.body);

      const [message] = await ctx.db
        .insert(caseMessages)
        .values({
          caseId: input.caseId,
          authorType: "client",
          portalAuthorId: ctx.portalUser.id,
          body: sanitizedBody,
        })
        .returning();

      // TODO: Emit portal_message_received notification to lawyer (Task 17)

      return message;
    }),
});
```

- [ ] **Step 2: Register in root.ts**

Add to `src/server/trpc/root.ts`:
```typescript
import { portalMessagesRouter } from "./routers/portal-messages";
portalMessages: portalMessagesRouter,
```

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/portal-messages.ts src/server/trpc/root.ts
git commit -m "feat(portal): add portal-messages router with list and send"
```

---

### Task 11: portal-invoices router + Stripe

**Files:**
- Create: `src/server/trpc/routers/portal-invoices.ts`
- Create: `src/server/services/stripe.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create Stripe service**

Create `src/server/services/stripe.ts`:
```typescript
import Stripe from "stripe";

let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2025-03-31.basil",
    });
  }
  return _stripe;
}
```

Check Stripe's latest API version at build time — use the one from `node_modules/stripe/types/index.d.ts`.

- [ ] **Step 2: Create portal-invoices router**

Create `src/server/trpc/routers/portal-invoices.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { invoices } from "@/server/db/schema/invoices";
import { invoiceLineItems } from "@/server/db/schema/invoice-line-items";
import { cases } from "@/server/db/schema/cases";
import { getStripe } from "@/server/services/stripe";

export const portalInvoicesRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid().optional(),
      cursor: z.string().uuid().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      // Base: all invoices for this client
      const conditions = [eq(invoices.clientId, ctx.portalUser.clientId)];

      if (input?.caseId) {
        // Verify case ownership + billing visibility
        const [caseRow] = await ctx.db
          .select({ id: cases.id, portalVisibility: cases.portalVisibility })
          .from(cases)
          .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
          .limit(1);
        if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
        const vis = caseRow.portalVisibility as Record<string, boolean> | null;
        if (!vis || vis.billing === false) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        // Filter invoices that have line items for this case
        const lineItemInvoiceIds = ctx.db
          .selectDistinct({ invoiceId: invoiceLineItems.invoiceId })
          .from(invoiceLineItems)
          .where(eq(invoiceLineItems.caseId, input.caseId));

        conditions.push(inArray(invoices.id, lineItemInvoiceIds));
      }

      const rows = await ctx.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          issuedDate: invoices.issuedDate,
          dueDate: invoices.dueDate,
          paidDate: invoices.paidDate,
          totalCents: invoices.totalCents,
        })
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.issuedDate))
        .limit(21);

      return {
        invoices: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),

  get: portalProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

      const lines = await ctx.db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, invoice.id))
        .orderBy(invoiceLineItems.sortOrder);

      return { ...invoice, lineItems: lines };
    }),

  createCheckoutSession: portalProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select()
        .from(invoices)
        .where(and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.clientId, ctx.portalUser.clientId),
          eq(invoices.status, "sent"),
        ))
        .limit(1);

      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found or already paid" });

      // If a previous checkout session exists, check if it's still active
      if (invoice.stripeCheckoutSessionId) {
        const stripe = getStripe();
        const existingSession = await stripe.checkout.sessions.retrieve(invoice.stripeCheckoutSessionId);
        if (existingSession.status === "open") {
          // Reuse the active session
          return { url: existingSession.url };
        }
        // Session expired/completed — allow creating a new one
      }

      const stripe = getStripe();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: invoice.totalCents,
            product_data: {
              name: `Invoice ${invoice.invoiceNumber}`,
            },
          },
          quantity: 1,
        }],
        metadata: {
          invoiceId: invoice.id,
          orgId: invoice.orgId ?? "",
          portalUserId: ctx.portalUser.id,
        },
        success_url: `${appUrl}/portal/invoices/${invoice.id}?paid=true`,
        cancel_url: `${appUrl}/portal/invoices/${invoice.id}`,
      });

      // Store session ID on invoice
      await ctx.db
        .update(invoices)
        .set({ stripeCheckoutSessionId: session.id })
        .where(eq(invoices.id, invoice.id));

      return { url: session.url };
    }),
});
```

- [ ] **Step 3: Register in root.ts**

Add to `src/server/trpc/root.ts`:
```typescript
import { portalInvoicesRouter } from "./routers/portal-invoices";
portalInvoices: portalInvoicesRouter,
```

- [ ] **Step 4: Commit**

```bash
git add src/server/services/stripe.ts src/server/trpc/routers/portal-invoices.ts src/server/trpc/root.ts
git commit -m "feat(portal): add portal-invoices router with Stripe Checkout"
```

---

### Task 12: portal-calendar, portal-tasks, portal-notifications routers

**Files:**
- Create: `src/server/trpc/routers/portal-calendar.ts`
- Create: `src/server/trpc/routers/portal-tasks.ts`
- Create: `src/server/trpc/routers/portal-notifications.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create portal-calendar router**

Create `src/server/trpc/routers/portal-calendar.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { caseCalendarEvents } from "@/server/db/schema/case-calendar-events";
import { cases } from "@/server/db/schema/cases";

export const portalCalendarRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      cursor: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      const vis = caseRow.portalVisibility as Record<string, boolean> | null;
      if (!vis || vis.calendar === false) throw new TRPCError({ code: "FORBIDDEN" });

      const rows = await ctx.db
        .select({
          id: caseCalendarEvents.id,
          title: caseCalendarEvents.title,
          description: caseCalendarEvents.description,
          kind: caseCalendarEvents.kind,
          startsAt: caseCalendarEvents.startsAt,
          endsAt: caseCalendarEvents.endsAt,
          location: caseCalendarEvents.location,
        })
        .from(caseCalendarEvents)
        .where(and(
          eq(caseCalendarEvents.caseId, input.caseId),
          gte(caseCalendarEvents.endsAt, new Date()),
        ))
        .orderBy(caseCalendarEvents.startsAt)
        .limit(21);

      return {
        events: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),
});
```

- [ ] **Step 2: Create portal-tasks router**

Create `src/server/trpc/routers/portal-tasks.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { cases } from "@/server/db/schema/cases";

export const portalTasksRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      cursor: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const [caseRow] = await ctx.db
        .select({ id: cases.id, portalVisibility: cases.portalVisibility })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
      const vis = caseRow.portalVisibility as Record<string, boolean> | null;
      if (!vis || vis.tasks === false) throw new TRPCError({ code: "FORBIDDEN" });

      const rows = await ctx.db
        .select({
          id: caseTasks.id,
          title: caseTasks.title,
          description: caseTasks.description,
          status: caseTasks.status,
          dueDate: caseTasks.dueDate,
          createdAt: caseTasks.createdAt,
        })
        .from(caseTasks)
        .where(eq(caseTasks.caseId, input.caseId))
        .orderBy(desc(caseTasks.createdAt))
        .limit(21);

      return {
        tasks: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),
});
```

- [ ] **Step 3: Create portal-notifications router**

Create `src/server/trpc/routers/portal-notifications.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc, sql } from "drizzle-orm";
import { router, portalProcedure } from "../trpc";
import { portalNotifications } from "@/server/db/schema/portal-notifications";

export const portalNotificationsRouter = router({
  list: portalProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const conditions = [eq(portalNotifications.portalUserId, ctx.portalUser.id)];

      if (input?.cursor) {
        const [cursorRow] = await ctx.db
          .select({ createdAt: portalNotifications.createdAt })
          .from(portalNotifications)
          .where(eq(portalNotifications.id, input.cursor))
          .limit(1);
        if (cursorRow) {
          conditions.push(sql`${portalNotifications.createdAt} < ${cursorRow.createdAt}`);
        }
      }

      const rows = await ctx.db
        .select()
        .from(portalNotifications)
        .where(and(...conditions))
        .orderBy(desc(portalNotifications.createdAt))
        .limit(limit + 1);

      return {
        notifications: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : undefined,
      };
    }),

  getUnreadCount: portalProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(portalNotifications)
      .where(and(
        eq(portalNotifications.portalUserId, ctx.portalUser.id),
        eq(portalNotifications.isRead, false),
      ));
    return result?.count ?? 0;
  }),

  markRead: portalProcedure
    .input(z.object({ notificationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(and(
          eq(portalNotifications.id, input.notificationId),
          eq(portalNotifications.portalUserId, ctx.portalUser.id),
        ));
      return { success: true };
    }),

  markAllRead: portalProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(portalNotifications)
      .set({ isRead: true })
      .where(and(
        eq(portalNotifications.portalUserId, ctx.portalUser.id),
        eq(portalNotifications.isRead, false),
      ));
    return { success: true };
  }),
});
```

- [ ] **Step 4: Register all three in root.ts**

Add to `src/server/trpc/root.ts`:
```typescript
import { portalCalendarRouter } from "./routers/portal-calendar";
import { portalTasksRouter } from "./routers/portal-tasks";
import { portalNotificationsRouter } from "./routers/portal-notifications";
// In router:
portalCalendar: portalCalendarRouter,
portalTasks: portalTasksRouter,
portalNotifications: portalNotificationsRouter,
```

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/portal-calendar.ts src/server/trpc/routers/portal-tasks.ts src/server/trpc/routers/portal-notifications.ts src/server/trpc/root.ts
git commit -m "feat(portal): add portal calendar, tasks, and notifications routers"
```

---

## Chunk 3: Lawyer-side Management + Stripe Webhook

### Task 13: portal-users router (lawyer-side)

**Files:**
- Create: `src/server/trpc/routers/portal-users.ts`
- Modify: `src/server/trpc/root.ts`
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Create portal-users router**

Create `src/server/trpc/routers/portal-users.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { portalUsers } from "@/server/db/schema/portal-users";
import { portalSessions } from "@/server/db/schema/portal-sessions";
import { clients } from "@/server/db/schema/clients";
import { assertClientRead } from "../lib/permissions";
import { sendPortalInviteEmail } from "@/server/services/portal-emails";

export const portalUsersRouter = router({
  invite: protectedProcedure
    .input(z.object({
      clientId: z.string().uuid(),
      email: z.email(),
      displayName: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = await assertClientRead(ctx, input.clientId);

      const displayName = input.displayName ?? client.displayName ?? input.email;
      const orgName = "ClearTerms"; // TODO: get org name if available

      const [existing] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.email, input.email),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Portal user already exists for this email" });
      }

      const [portalUser] = await ctx.db
        .insert(portalUsers)
        .values({
          email: input.email,
          clientId: input.clientId,
          orgId: ctx.user.orgId ?? undefined,
          userId: ctx.user.orgId ? undefined : ctx.user.id,
          displayName,
        })
        .returning();

      await sendPortalInviteEmail(input.email, displayName, orgName);

      return portalUser;
    }),

  list: protectedProcedure
    .input(z.object({ clientId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = ctx.user.orgId
        ? [eq(portalUsers.orgId, ctx.user.orgId)]
        : [eq(portalUsers.userId, ctx.user.id)];

      if (input?.clientId) {
        conditions.push(eq(portalUsers.clientId, input.clientId));
      }

      return ctx.db
        .select()
        .from(portalUsers)
        .where(and(...conditions))
        .orderBy(desc(portalUsers.createdAt));
    }),

  disable: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      // Disable + revoke all sessions
      await ctx.db.update(portalUsers).set({ status: "disabled" }).where(eq(portalUsers.id, pu.id));
      await ctx.db.delete(portalSessions).where(eq(portalSessions.portalUserId, pu.id));

      return { success: true };
    }),

  enable: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.update(portalUsers).set({ status: "active" }).where(eq(portalUsers.id, pu.id));
      return { success: true };
    }),

  resendInvite: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      await sendPortalInviteEmail(pu.email, pu.displayName, "ClearTerms");
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      // Delete sessions first, then the user (cascade handles the rest)
      await ctx.db.delete(portalSessions).where(eq(portalSessions.portalUserId, pu.id));
      await ctx.db.delete(portalUsers).where(eq(portalUsers.id, pu.id));

      return { success: true };
    }),
});
```

- [ ] **Step 2: Add updatePortalVisibility to cases router**

Modify `src/server/trpc/routers/cases.ts` — add procedure:
```typescript
updatePortalVisibility: protectedProcedure
  .input(z.object({
    caseId: z.string().uuid(),
    visibility: z.object({
      documents: z.boolean(),
      tasks: z.boolean(),
      calendar: z.boolean(),
      billing: z.boolean(),
      messages: z.boolean(),
    }),
  }))
  .mutation(async ({ ctx, input }) => {
    // Use existing assertCaseAccess or equivalent
    const [updated] = await ctx.db
      .update(cases)
      .set({ portalVisibility: input.visibility })
      .where(and(
        eq(cases.id, input.caseId),
        ctx.user.orgId
          ? eq(cases.orgId, ctx.user.orgId)
          : eq(cases.userId, ctx.user.id),
      ))
      .returning({ id: cases.id });

    if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
    return { success: true };
  }),
```

- [ ] **Step 3: Register portal-users in root.ts**

Add to `src/server/trpc/root.ts`:
```typescript
import { portalUsersRouter } from "./routers/portal-users";
portalUsers: portalUsersRouter,
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/portal-users.ts src/server/trpc/routers/cases.ts src/server/trpc/root.ts
git commit -m "feat(portal): add portal-users router and updatePortalVisibility"
```

---

### Task 14: Stripe webhook handler

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Create Stripe webhook route**

Create `src/app/api/webhooks/stripe/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { invoices } from "@/server/db/schema/invoices";
import { getStripe } from "@/server/services/stripe";
import { inngest } from "@/server/inngest/client";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;

    if (invoiceId) {
      // Update invoice status
      await db
        .update(invoices)
        .set({ status: "paid", paidDate: new Date() })
        .where(eq(invoices.id, invoiceId));

      // Emit notifications
      await inngest.send({
        name: "notification/send",
        data: {
          type: "invoice_paid",
          title: "Invoice paid",
          body: `Invoice has been paid`,
          // userId will be resolved in handle-notification from invoice.orgId
          orgId: session.metadata?.orgId,
          metadata: { invoiceId },
        },
      });

      // TODO: Emit portal notification for payment_confirmed to client
    }
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 2: Add /api/webhooks/stripe to public routes in middleware**

The existing middleware's `isPublicRoute` already includes `/api/webhooks(.*)`, so `/api/webhooks/stripe` is already covered. No change needed.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat(portal): add Stripe webhook handler for checkout.session.completed"
```

---

### Task 15: Portal SSE endpoint

**Files:**
- Create: `src/app/api/portal/notifications/stream/route.ts`

- [ ] **Step 1: Create portal SSE endpoint**

Create `src/app/api/portal/notifications/stream/route.ts`:
```typescript
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { db } from "@/server/db";
import { portalNotificationSignals } from "@/server/db/schema/portal-notifications";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Parse portal_token from cookie
  const cookieHeader = req.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith("portal_token="))
    ?.split("=")[1]
    ?.trim();

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let portalUserId: string;
  try {
    const secret = new TextEncoder().encode(process.env.PORTAL_JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    portalUserId = payload.sub as string;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let lastSignalAt: Date | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      const interval = setInterval(async () => {
        try {
          const [signal] = await db
            .select({ updatedAt: portalNotificationSignals.updatedAt })
            .from(portalNotificationSignals)
            .where(eq(portalNotificationSignals.portalUserId, portalUserId))
            .limit(1);

          if (signal && (!lastSignalAt || signal.updatedAt > lastSignalAt)) {
            lastSignalAt = signal.updatedAt;
            controller.enqueue(encoder.encode("event: notification\ndata: {}\n\n"));
          }
        } catch {
          // Swallow
        }
      }, 2000);

      const cleanup = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      };

      setTimeout(cleanup, (maxDuration - 10) * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Add portal SSE to public routes in middleware**

Modify `src/middleware.ts` — the portal SSE endpoint is under `/api/portal/` which starts with `/portal`, so it's caught by our portal middleware early-return. However, the API route is at `/api/portal/...` not `/portal/...`. Need to also handle this:

Add to the portal middleware check:
```typescript
if (req.nextUrl.pathname.startsWith("/portal") || req.nextUrl.pathname.startsWith("/api/portal")) {
```

And for `/api/portal/notifications/stream`, verify the JWT in the SSE handler itself (already done), so just allow it through the middleware.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/portal/notifications/stream/route.ts src/middleware.ts
git commit -m "feat(portal): add portal SSE endpoint for real-time notifications"
```

---

### Task 16: Register new notification types

**Files:**
- Modify: `src/lib/notification-types.ts`

- [ ] **Step 1: Add portal notification types to lawyer-side system**

Modify `src/lib/notification-types.ts`:

Add to `NOTIFICATION_TYPES` array:
```typescript
"portal_message_received",
"portal_document_uploaded",
```

Add new category to `NOTIFICATION_CATEGORIES`:
```typescript
portal: ["portal_message_received", "portal_document_uploaded"] as const,
```

Add to `NotificationMetadata` type:
```typescript
portal_message_received: { caseName: string; clientName: string; messagePreview: string };
portal_document_uploaded: { caseName: string; clientName: string; documentName: string };
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/notification-types.ts
git commit -m "feat(portal): register portal_message_received and portal_document_uploaded notification types"
```

---

### Task 17: Extend Inngest handle-notification for portal delivery

**Files:**
- Modify: `src/server/inngest/functions/handle-notification.ts`
- Modify: `src/server/services/portal-emails.ts`

- [ ] **Step 1: Add portal email templates**

Add to `src/server/services/portal-emails.ts`:
```typescript
export async function sendPortalNotificationEmail(to: string, title: string, body: string, actionUrl?: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const fullUrl = actionUrl ? `${appUrl}${actionUrl}` : undefined;

  await sendEmail({
    to,
    subject: `ClearTerms: ${title}`,
    html: `
      <h2>${title}</h2>
      <p>${body}</p>
      ${fullUrl ? `<a href="${fullUrl}" style="display:inline-block;padding:12px 24px;background:#7c83ff;color:#fff;text-decoration:none;border-radius:6px;">View Details</a>` : ""}
    `,
  });
}
```

- [ ] **Step 2: Add portal notification delivery to handle-notification**

Modify `src/server/inngest/functions/handle-notification.ts`:

Add a new event type `"portal-notification/send"` or extend the existing handler to check for `portalUserId` in the event data. When `portalUserId` is present:

1. Insert into `portal_notifications` table
2. Bump `portal_notification_signals`
3. Check `portal_notification_preferences` for email opt-out
4. Send email if enabled via `sendPortalNotificationEmail`

```typescript
// Add to handle-notification or create new Inngest function:
import { portalNotifications, portalNotificationSignals } from "../../db/schema/portal-notifications";
import { portalNotificationPreferences } from "../../db/schema/portal-notification-preferences";
import { sendPortalNotificationEmail } from "../../services/portal-emails";

// When portalUserId is in the event:
async function deliverPortalNotification(event: any) {
  const { portalUserId, type, title, body, caseId, actionUrl, dedupKey } = event;

  // Insert notification
  await db.insert(portalNotifications).values({
    portalUserId,
    type,
    title,
    body,
    caseId,
    actionUrl,
    dedupKey,
  }).onConflictDoNothing(); // dedup_key

  // Bump signal
  await db
    .insert(portalNotificationSignals)
    .values({ portalUserId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalNotificationSignals.portalUserId,
      set: { updatedAt: new Date() },
    });

  // Check email preference
  const [pref] = await db
    .select()
    .from(portalNotificationPreferences)
    .where(and(
      eq(portalNotificationPreferences.portalUserId, portalUserId),
      eq(portalNotificationPreferences.type, type),
    ))
    .limit(1);

  const emailEnabled = !pref || pref.emailEnabled; // default true

  if (emailEnabled) {
    const [user] = await db.select().from(portalUsers).where(eq(portalUsers.id, portalUserId)).limit(1);
    if (user) {
      await sendPortalNotificationEmail(user.email, title, body, actionUrl);
    }
  }
}
```

Register as new Inngest function if cleaner than modifying existing handler.

- [ ] **Step 3: Commit**

```bash
git add src/server/inngest/functions/ src/server/services/portal-emails.ts
git commit -m "feat(portal): add portal notification delivery via Inngest"
```

---

## Chunk 4: Portal UI Pages

### Task 18: Portal shell (sidebar + layout)

**Files:**
- Create: `src/components/portal/portal-shell.tsx`
- Create: `src/components/portal/portal-sidebar.tsx`
- Modify: `src/app/(portal)/layout.tsx`
- Create: `src/hooks/use-portal-notification-stream.ts`

- [ ] **Step 1: Create portal notification stream hook**

Create `src/hooks/use-portal-notification-stream.ts` — same pattern as `src/hooks/use-notification-stream.ts` but pointing to `/api/portal/notifications/stream` and invalidating `portalNotifications` queries.

- [ ] **Step 2: Create portal sidebar**

Create `src/components/portal/portal-sidebar.tsx`:
- Logo, nav links: Dashboard, Cases, Messages (with unread badge), Invoices, Settings
- User info at bottom with logout button
- Use `trpc.portalNotifications.getUnreadCount.useQuery()` for badge
- Active link highlighting via `usePathname()`

- [ ] **Step 3: Create portal shell**

Create `src/components/portal/portal-shell.tsx`:
```typescript
"use client";

import { PortalSidebar } from "./portal-sidebar";
import { usePortalNotificationStream } from "@/hooks/use-portal-notification-stream";

export function PortalShell({ children }: { children: React.ReactNode }) {
  usePortalNotificationStream();

  return (
    <div className="flex h-screen">
      <PortalSidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Update portal layout**

Modify `src/app/(portal)/layout.tsx` to use PortalShell for all non-login pages. The login page should NOT have the shell. Use nested route groups or conditional rendering.

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/ src/hooks/use-portal-notification-stream.ts src/app/\(portal\)/
git commit -m "feat(portal): add portal shell with sidebar and notification stream"
```

---

### Task 19: Portal dashboard page

**Files:**
- Create: `src/app/(portal)/portal/(authenticated)/page.tsx`
- Create: `src/components/portal/dashboard-stats.tsx`
- Create: `src/components/portal/recent-activity.tsx`

- [ ] **Step 1: Create dashboard page components**

Dashboard shows:
- Stats cards: active cases count, unpaid invoices count + total, unread messages count
- Recent activity feed from portal notifications

Use `trpc.portalCases.list`, `trpc.portalInvoices.list`, `trpc.portalNotifications.list` queries.

- [ ] **Step 2: Create dashboard page**

Page at `/portal` that renders stats + activity.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(portal\)/ src/components/portal/
git commit -m "feat(portal): add portal dashboard page with stats and activity"
```

---

### Task 20: Cases list + case detail page

**Files:**
- Create: `src/app/(portal)/portal/(authenticated)/cases/page.tsx`
- Create: `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`
- Create: `src/components/portal/case-card.tsx`
- Create: `src/components/portal/case-detail-tabs.tsx`
- Create: `src/components/portal/case-overview-tab.tsx`
- Create: `src/components/portal/case-documents-tab.tsx`
- Create: `src/components/portal/case-messages-tab.tsx`
- Create: `src/components/portal/case-tasks-tab.tsx`
- Create: `src/components/portal/case-calendar-tab.tsx`
- Create: `src/components/portal/case-invoices-tab.tsx`

- [ ] **Step 1: Create cases list page**

List cases with `trpc.portalCases.list` — show name, status badge, last updated.

- [ ] **Step 2: Create case detail with tab navigation**

Case detail page with tabs controlled by `portalVisibility`:
- Overview (always visible): case name, status, description, next event, tasks count
- Documents tab: file list + upload button + download links
- Messages tab: chat-style thread + input
- Tasks tab: task list (read-only)
- Calendar tab: upcoming events
- Invoices tab: case-specific invoices with pay button

Each tab is a separate component. Hidden tabs don't render.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(portal\)/portal/\(authenticated\)/cases/ src/components/portal/case-*
git commit -m "feat(portal): add cases list and case detail with tabbed sections"
```

---

### Task 21: Messages page

**Files:**
- Create: `src/app/(portal)/portal/(authenticated)/messages/page.tsx`
- Create: `src/components/portal/message-thread.tsx`

- [ ] **Step 1: Create messages page**

Shows all message threads across all cases. Group by case, show latest message preview. Click → navigate to case detail Messages tab.

Uses `trpc.portalCases.list` to get cases, then can show a preview.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(portal\)/portal/\(authenticated\)/messages/ src/components/portal/message-thread.tsx
git commit -m "feat(portal): add portal messages page"
```

---

### Task 22: Invoices page + invoice detail

**Files:**
- Create: `src/app/(portal)/portal/(authenticated)/invoices/page.tsx`
- Create: `src/app/(portal)/portal/(authenticated)/invoices/[id]/page.tsx`
- Create: `src/components/portal/invoice-row.tsx`
- Create: `src/components/portal/invoice-detail.tsx`

- [ ] **Step 1: Create invoices list page**

List all client invoices with status badge and "Pay Now" button for unpaid.

- [ ] **Step 2: Create invoice detail page**

Show invoice detail with line items and pay button. Handle `?paid=true` query param for success state.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(portal\)/portal/\(authenticated\)/invoices/ src/components/portal/invoice-*
git commit -m "feat(portal): add invoices list and detail pages with Stripe pay"
```

---

### Task 23: Settings page

**Files:**
- Create: `src/app/(portal)/portal/(authenticated)/settings/page.tsx`
- Create: `src/components/portal/notification-settings.tsx`
- Create: `src/server/trpc/routers/portal-notification-preferences.ts`

- [ ] **Step 1: Create portal notification preferences router**

Create `src/server/trpc/routers/portal-notification-preferences.ts`:
```typescript
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { router, portalProcedure } from "../trpc";
import { portalNotificationPreferences } from "@/server/db/schema/portal-notification-preferences";

const PORTAL_NOTIFICATION_TYPES = [
  "message_received",
  "document_uploaded",
  "invoice_sent",
  "case_stage_changed",
  "task_assigned",
  "event_reminder",
  "payment_confirmed",
] as const;

export const portalNotificationPreferencesRouter = router({
  list: portalProcedure.query(async ({ ctx }) => {
    const prefs = await ctx.db
      .select()
      .from(portalNotificationPreferences)
      .where(eq(portalNotificationPreferences.portalUserId, ctx.portalUser.id));

    // Return full matrix with defaults
    return PORTAL_NOTIFICATION_TYPES.map((type) => {
      const pref = prefs.find((p) => p.type === type);
      return { type, emailEnabled: pref?.emailEnabled ?? true };
    });
  }),

  update: portalProcedure
    .input(z.object({
      type: z.enum(PORTAL_NOTIFICATION_TYPES),
      emailEnabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(portalNotificationPreferences)
        .values({
          portalUserId: ctx.portalUser.id,
          type: input.type,
          emailEnabled: input.emailEnabled,
        })
        .onConflictDoUpdate({
          target: [portalNotificationPreferences.portalUserId, portalNotificationPreferences.type],
          set: { emailEnabled: input.emailEnabled, updatedAt: new Date() },
        });
      return { success: true };
    }),

  resetDefaults: portalProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(portalNotificationPreferences)
      .where(eq(portalNotificationPreferences.portalUserId, ctx.portalUser.id));
    return { success: true };
  }),
});
```

Add to `src/server/trpc/root.ts`:
```typescript
import { portalNotificationPreferencesRouter } from "./routers/portal-notification-preferences";
// In router:
portalNotificationPreferences: portalNotificationPreferencesRouter,
```

- [ ] **Step 2: Create settings page**

Notification preferences toggles — one row per notification type, toggle for email on/off. Reset to defaults button.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/portal-notification-preferences.ts src/server/trpc/root.ts src/app/\(portal\)/portal/\(authenticated\)/settings/ src/components/portal/notification-settings.tsx
git commit -m "feat(portal): add portal settings page with notification preferences"
```

---

## Chunk 5: Lawyer-side UI + Migration + Build

### Task 24: Lawyer-side portal management UI

**Files:**
- Create: `src/components/portal/portal-access-panel.tsx`
- Create: `src/components/portal/portal-visibility-panel.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Create portal access panel**

Component for client detail page — shows portal user status, invite button, disable/enable, resend invite.

- [ ] **Step 2: Create portal visibility panel**

Component for case detail page — toggle switches for each section (documents, tasks, calendar, billing, messages).

- [ ] **Step 3: Add panels to existing pages**

Add PortalAccessPanel to client detail page.
Add PortalVisibilityPanel to case detail page.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/ src/app/\(app\)/clients/ src/app/\(app\)/cases/
git commit -m "feat(portal): add lawyer-side portal management UI to client and case pages"
```

---

### Task 25: Run migration + build verification

- [ ] **Step 1: Generate final migration**

```bash
npm run db:generate
```

Review the generated SQL. Ensure it includes:
- All 7 new tables with correct FKs
- CHECK constraints on `portal_users` and `case_messages`
- Partial unique indexes on `portal_users`
- New columns on `cases`, `documents`, `invoices`

- [ ] **Step 2: Push migration to dev DB**

```bash
npm run db:push
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Fix any type errors.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Fix any lint errors.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(portal): resolve build and lint issues"
```

---

### Task 26: Update notification types and wire TODO notifications

Go back and wire up the TODO comments left in Tasks 9, 10, 14:

- [ ] **Step 1: Wire portal_document_uploaded notification in portal-documents.confirmUpload**

After confirming upload, emit Inngest event to notify lawyer.

- [ ] **Step 2: Wire portal_message_received notification in portal-messages.send**

After sending message, emit Inngest event to notify case members.

- [ ] **Step 3: Wire payment_confirmed portal notification in Stripe webhook**

After processing checkout.session.completed, emit portal notification to client.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/portal-documents.ts src/server/trpc/routers/portal-messages.ts src/app/api/webhooks/stripe/route.ts
git commit -m "feat(portal): wire up notification emissions for portal events"
```

---

### Task 27: Final build + manual smoke test

- [ ] **Step 1: Full build**

```bash
npm run build && npm run lint
```

- [ ] **Step 2: Verify all portal routes are accessible**

Start dev server, verify:
- `/portal/login` loads without auth
- `/portal` redirects to login when not authenticated
- All other portal routes redirect to login when not authenticated

- [ ] **Step 3: Commit and tag**

```bash
git add -A
git commit -m "feat(portal): 2.1.8 Client Portal complete"
```
