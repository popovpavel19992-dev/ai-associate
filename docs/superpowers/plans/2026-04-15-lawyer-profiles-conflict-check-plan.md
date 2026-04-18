# 2.1.9 Lawyer Profiles & Conflict of Interest Check — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add extended lawyer profile fields (bio, bar number, avatar, signature) with portal exposure, and conflict-of-interest warning on client creation via opposing party tracking on cases.

**Architecture:** Extend existing `users` and `cases` schemas with new columns. New dedicated presign route for profile images. New `portal-lawyer` router for portal-side lawyer profile fetching. Conflict check as a new tRPC query on the clients router with debounced client-side calls.

**Tech Stack:** Next.js 16, tRPC 11, Drizzle ORM, PostgreSQL, AWS S3, Zod v4

---

## Chunk 1: Schema & Backend

### Task 1: Schema — Add new columns to users and cases

**Files:**
- Modify: `src/server/db/schema/users.ts`
- Modify: `src/server/db/schema/cases.ts`

- [ ] **Step 1: Add new columns to users schema**

In `src/server/db/schema/users.ts`, add after `creditsUsedThisMonth`:

```ts
bio: text("bio"),
barNumber: text("bar_number"),
barState: text("bar_state"), // State of bar admission (distinct from `state` which is practice state)
avatarUrl: text("avatar_url"),
signatureImageUrl: text("signature_image_url"),
```

- [ ] **Step 2: Add new columns to cases schema**

In `src/server/db/schema/cases.ts`, add after `description`:

```ts
opposingParty: text("opposing_party"),
opposingCounsel: text("opposing_counsel"),
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS (new nullable columns are additive)

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/users.ts src/server/db/schema/cases.ts
git commit -m "feat: add lawyer profile and opposing party columns to schema"
```

---

### Task 2: Profile presign route and S3 helper

**Files:**
- Modify: `src/server/services/s3.ts`
- Create: `src/app/api/upload/presign-profile/route.ts`

- [ ] **Step 1: Add `generateProfilePresignedUrl` to s3.ts**

Add a new exported function at the end of `src/server/services/s3.ts`:

```ts
const PROFILE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_SIZE_LIMITS: Record<string, number> = {
  avatar: 2 * 1024 * 1024,    // 2MB
  signature: 1 * 1024 * 1024, // 1MB
};

export function validateProfileUpload(
  category: "avatar" | "signature",
  contentType: string,
  fileSize: number,
) {
  if (!PROFILE_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}. Allowed: JPEG, PNG, WebP.`);
  }
  const maxSize = PROFILE_SIZE_LIMITS[category]!;
  if (fileSize > maxSize) {
    throw new Error(`File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB. Maximum: ${(maxSize / 1024 / 1024).toFixed(0)}MB.`);
  }
  if (fileSize <= 0) {
    throw new Error("File size must be greater than 0.");
  }
}

export async function generateProfilePresignedUrl(
  userId: string,
  category: "avatar" | "signature",
  filename: string,
  contentType: string,
  fileSize: number,
): Promise<{ uploadUrl: string; s3Key: string }> {
  validateProfileUpload(category, contentType, fileSize);

  const fileId = crypto.randomUUID();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `profiles/${userId}/${category}/${fileId}/${sanitizedFilename}`;

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: s3Key,
    ContentType: contentType,
    ContentLength: fileSize,
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: getKmsKeyId(),
  });

  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  return { uploadUrl, s3Key };
}
```

- [ ] **Step 2: Create presign-profile route**

Create `src/app/api/upload/presign-profile/route.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { eq } from "drizzle-orm";
import { generateProfilePresignedUrl } from "@/server/services/s3";

const schema = z.object({
  category: z.enum(["avatar", "signature"]),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  fileSize: z.number().int().positive(),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { category, filename, contentType, fileSize } = parsed.data;

  try {
    const { uploadUrl, s3Key } = await generateProfilePresignedUrl(
      user.id,
      category,
      filename,
      contentType,
      fileSize,
    );
    return Response.json({ uploadUrl, s3Key });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/services/s3.ts src/app/api/upload/presign-profile/route.ts
git commit -m "feat: add profile image presign route and S3 helper"
```

---

### Task 3: Extend users router — updateProfile and getProfile

**Files:**
- Modify: `src/server/trpc/routers/users.ts`

- [ ] **Step 1: Extend updateProfile input schema and mutation**

In `src/server/trpc/routers/users.ts`, add new fields to the `updateProfile` input `z.object({...})`:

```ts
bio: z.string().max(2000).optional(),
barNumber: z.string().max(50).optional(),
barState: z.enum(US_STATES).optional(),
avatarUrl: z.url().optional(),
signatureImageUrl: z.url().optional(),
```

And add to the mutation body (in the `updates` building block):

```ts
if (input.bio !== undefined) updates.bio = input.bio;
if (input.barNumber !== undefined) updates.barNumber = input.barNumber;
if (input.barState !== undefined) updates.barState = input.barState;
if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;
if (input.signatureImageUrl !== undefined) updates.signatureImageUrl = input.signatureImageUrl;
```

- [ ] **Step 2: Verify getProfile already returns new fields**

`getProfile` returns `{ ...ctx.user, maxSeats }`. Since `ctx.user` is the full `users` row from the `select()` in `trpc.ts`, the new columns are automatically included. No changes needed.

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/users.ts
git commit -m "feat: extend updateProfile with lawyer profile fields"
```

---

### Task 4: Extend cases router — opposing party fields

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Add opposingParty and opposingCounsel to cases.create input**

In `cases.create` input `z.object({...})`, add:

```ts
opposingParty: z.string().max(200).optional(),
opposingCounsel: z.string().max(200).optional(),
```

In the `.values({...})` of the insert, add:

```ts
opposingParty: input.opposingParty ?? null,
opposingCounsel: input.opposingCounsel ?? null,
```

- [ ] **Step 2: Add opposingParty and opposingCounsel to cases.update input**

In `cases.update` input `z.object({...})`, add:

```ts
opposingParty: z.string().max(200).optional(),
opposingCounsel: z.string().max(200).optional(),
```

In the mutation body, add to the `patch` building:

```ts
if (input.opposingParty !== undefined) patch.opposingParty = input.opposingParty;
if (input.opposingCounsel !== undefined) patch.opposingCounsel = input.opposingCounsel;
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat: add opposing party fields to case create/update"
```

---

### Task 5: Conflict check procedure

**Files:**
- Modify: `src/server/trpc/routers/clients.ts`

- [ ] **Step 1: Update drizzle-orm imports**

In `src/server/trpc/routers/clients.ts`, change the drizzle-orm import (line 3) from:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
```

To:

```ts
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
```

- [ ] **Step 2: Add `checkConflict` query to clients router**

Add a new procedure to `clientsRouter` in `src/server/trpc/routers/clients.ts`:

```ts
checkConflict: protectedProcedure
  .input(z.object({ name: z.string().min(1).max(200) }))
  .query(async ({ ctx, input }) => {
    const pattern = `%${input.name}%`;

    // Scope: all org cases (intentionally broader than case-level access).
    // Includes legacy pre-org cases (orgId IS NULL, userId match).
    const legacyOwned = and(isNull(cases.orgId), eq(cases.userId, ctx.user.id));
    const scopeWhere = ctx.user.orgId
      ? or(eq(cases.orgId, ctx.user.orgId), legacyOwned)!
      : eq(cases.userId, ctx.user.id);

    const matches = await ctx.db
      .select({
        caseId: cases.id,
        caseName: cases.name,
        opposingParty: cases.opposingParty,
        opposingCounsel: cases.opposingCounsel,
        clientDisplayName: clients.displayName,
      })
      .from(cases)
      .leftJoin(clients, eq(cases.clientId, clients.id))
      .where(
        and(
          scopeWhere,
          or(
            sql`${cases.opposingParty} ILIKE ${pattern}`,
            sql`${cases.opposingCounsel} ILIKE ${pattern}`,
          ),
        ),
      )
      .limit(10);

    return { matches };
  }),
```

- [ ] **Step 2: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/clients.ts
git commit -m "feat: add conflict of interest check procedure"
```

---

### Task 6: Portal lawyer profile router

**Files:**
- Create: `src/server/trpc/routers/portal-lawyer.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Create portal-lawyer.ts router**

Create `src/server/trpc/routers/portal-lawyer.ts`:

```ts
import { eq, and } from "drizzle-orm";
import { router, portalProcedure } from "../trpc";
import { users } from "../../db/schema/users";

export const portalLawyerRouter = router({
  getProfile: portalProcedure.query(async ({ ctx }) => {
    // Solo: portalUser.userId is set, orgId is null
    // Firm: portalUser.orgId is set, userId is null
    const where = ctx.portalUser.orgId === null
      ? eq(users.id, ctx.portalUser.userId!)
      : and(eq(users.orgId, ctx.portalUser.orgId!), eq(users.role, "owner"));

    const [lawyer] = await ctx.db
      .select({
        name: users.name,
        bio: users.bio,
        avatarUrl: users.avatarUrl,
        practiceAreas: users.practiceAreas,
        state: users.state,
        jurisdiction: users.jurisdiction,
        barNumber: users.barNumber,
        barState: users.barState,
      })
      .from(users)
      .where(where)
      .limit(1);

    return lawyer ?? null;
  }),
});
```

- [ ] **Step 2: Register in root.ts**

In `src/server/trpc/root.ts`, add import:

```ts
import { portalLawyerRouter } from "./routers/portal-lawyer";
```

Add to the `appRouter` object:

```ts
portalLawyer: portalLawyerRouter,
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/portal-lawyer.ts src/server/trpc/root.ts
git commit -m "feat: add portal-lawyer router for client-side lawyer profile"
```

---

## Chunk 2: UI — Settings, Cases, Client Forms, Portal

### Task 7: Settings page — Professional Profile card

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`
- Create: `src/components/settings/profile-image-upload.tsx`

- [ ] **Step 1: Create reusable profile image upload component**

Create `src/components/settings/profile-image-upload.tsx`:

```tsx
"use client";

import { useState, useRef } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  label: string;
  currentUrl: string | null;
  category: "avatar" | "signature";
  /** CSS class for the preview container */
  previewClassName?: string;
  onUploaded: (url: string) => void;
}

export function ProfileImageUpload({ label, currentUrl, category, previewClassName, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await fetch("/api/upload/presign-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Upload failed");
      }

      const { uploadUrl, s3Key } = await res.json();

      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      // Construct the public URL from the S3 key
      const publicUrl = `https://${process.env.NEXT_PUBLIC_AWS_S3_BUCKET}.s3.amazonaws.com/${s3Key}`;
      setPreview(publicUrl);
      onUploaded(publicUrl);
      toast.success(`${label} uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-4">
        {preview ? (
          <div className="relative">
            <img
              src={preview}
              alt={label}
              className={previewClassName ?? "h-16 w-16 rounded-full object-cover"}
            />
            <button
              type="button"
              onClick={() => { setPreview(null); onUploaded(""); }}
              className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className={previewClassName ?? "flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/25"}>
            <Upload className="h-5 w-5 text-muted-foreground/50" />
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {preview ? "Change" : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Professional Profile card to settings page**

In `src/app/(app)/settings/page.tsx`, add after the existing `</Card>` (before the closing `</div>` of the root):

Add `Textarea` to UI imports:
```ts
import { Textarea } from "@/components/ui/textarea";
```

Add `ProfileImageUpload` import:
```ts
import { ProfileImageUpload } from "@/components/settings/profile-image-upload";
```

Add state variables after existing state:
```ts
const [bio, setBio] = useState("");
const [barNumber, setBarNumber] = useState("");
const [barState, setBarState] = useState("");
const [avatarUrl, setAvatarUrl] = useState("");
const [signatureImageUrl, setSignatureImageUrl] = useState("");
```

Extend the `useEffect` that syncs from `profile`:
```ts
setBio(profile.bio ?? "");
setBarNumber(profile.barNumber ?? "");
setBarState(profile.barState ?? "");
setAvatarUrl(profile.avatarUrl ?? "");
setSignatureImageUrl(profile.signatureImageUrl ?? "");
```

Replace the entire `handleSave` function with:
```ts
const handleSave = () => {
  update.mutate({
    name: name.trim() || undefined,
    state: state ? (state as (typeof US_STATES)[number]) : undefined,
    jurisdiction: jurisdiction.trim() || undefined,
    practiceAreas:
      practiceAreas.length > 0
        ? (practiceAreas as (typeof PRACTICE_AREAS)[number][])
        : undefined,
    caseTypes:
      caseTypes.length > 0
        ? (caseTypes as (typeof CASE_TYPES)[number][])
        : undefined,
    bio: bio.trim() || undefined,
    barNumber: barNumber.trim() || undefined,
    barState: barState ? (barState as (typeof US_STATES)[number]) : undefined,
    avatarUrl: avatarUrl || undefined,
    signatureImageUrl: signatureImageUrl || undefined,
  });
};
```

Add new card JSX after the existing Profile `</Card>`:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Professional Profile</CardTitle>
  </CardHeader>
  <CardContent className="space-y-6">
    <ProfileImageUpload
      label="Profile Photo"
      currentUrl={avatarUrl || null}
      category="avatar"
      previewClassName="h-20 w-20 rounded-full object-cover"
      onUploaded={setAvatarUrl}
    />

    <div className="space-y-2">
      <Label htmlFor="bio">Bio</Label>
      <Textarea
        id="bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        maxLength={2000}
        rows={4}
        placeholder="Brief professional bio visible to clients..."
      />
      <p className="text-xs text-muted-foreground">{bio.length}/2000</p>
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="barNumber">Bar Number</Label>
        <Input
          id="barNumber"
          value={barNumber}
          onChange={(e) => setBarNumber(e.target.value)}
          placeholder="e.g. 12345"
          maxLength={50}
        />
      </div>
      <div className="space-y-2">
        <Label>Bar Admission State</Label>
        <Select value={barState} onValueChange={(v) => setBarState(v ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent>
            {US_STATES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>

    <ProfileImageUpload
      label="Signature Image"
      currentUrl={signatureImageUrl || null}
      category="signature"
      previewClassName="h-12 w-auto max-w-[200px] rounded border object-contain"
      onUploaded={setSignatureImageUrl}
    />

    <Button onClick={handleSave} disabled={update.isPending}>
      {update.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-2 h-4 w-4" />
      )}
      Save Changes
    </Button>
  </CardContent>
</Card>
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/profile-image-upload.tsx src/app/\(app\)/settings/page.tsx
git commit -m "feat: add Professional Profile card to settings page"
```

---

### Task 8: Case forms — opposing party fields

**Files:**
- Modify: `src/components/cases/create-case-form.tsx`

- [ ] **Step 1: Add opposing party state and inputs to create-case-form**

In `src/components/cases/create-case-form.tsx`, add state variables after existing state:

```ts
const [opposingParty, setOpposingParty] = useState("");
const [opposingCounsel, setOpposingCounsel] = useState("");
```

In `handleCreateCase`, extend the `createCase.mutate({...})` call:

```ts
opposingParty: opposingParty.trim() || undefined,
opposingCounsel: opposingCounsel.trim() || undefined,
```

In the JSX, add a new section after the Case Type section (before Analysis Sections):

```tsx
<div className="grid gap-4 sm:grid-cols-2">
  <div className="space-y-2">
    <Label htmlFor="opposing-party">Opposing Party</Label>
    <Input
      id="opposing-party"
      placeholder="Name of opposing party"
      value={opposingParty}
      onChange={(e) => setOpposingParty(e.target.value)}
      maxLength={200}
    />
  </div>
  <div className="space-y-2">
    <Label htmlFor="opposing-counsel">Opposing Counsel</Label>
    <Input
      id="opposing-counsel"
      placeholder="Name of opposing counsel"
      value={opposingCounsel}
      onChange={(e) => setOpposingCounsel(e.target.value)}
      maxLength={200}
    />
  </div>
</div>
```

- [ ] **Step 2: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/create-case-form.tsx
git commit -m "feat: add opposing party fields to case creation form"
```

---

### Task 9: Case detail — show and edit opposing party

**Files:**
- Modify: `src/components/cases/case-overview.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Add opposing party props to CaseOverview**

In `src/components/cases/case-overview.tsx`, extend the `CaseOverviewProps` interface:

```ts
opposingParty: string | null;
opposingCounsel: string | null;
onUpdateOpposingParty?: (value: string) => void;
onUpdateOpposingCounsel?: (value: string) => void;
```

Add the new props to the destructured params. Add a new card in the grid (after the Description card, before Quick Stats):

```tsx
{/* Opposing Parties */}
<div className="rounded-lg border border-zinc-800 p-4 md:col-span-2">
  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
    Opposing Parties
  </p>
  <div className="grid gap-4 sm:grid-cols-2">
    <div>
      <p className="text-xs text-zinc-500 mb-1">Opposing Party</p>
      <p className="text-sm text-zinc-300">{opposingParty || "—"}</p>
    </div>
    <div>
      <p className="text-xs text-zinc-500 mb-1">Opposing Counsel</p>
      <p className="text-sm text-zinc-300">{opposingCounsel || "—"}</p>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Pass props from case detail page**

In `src/app/(app)/cases/[id]/page.tsx`, extend the `<CaseOverview>` call to pass the new props:

```tsx
<CaseOverview
  stage={currentStage}
  stageChangedAt={caseData.stageChangedAt}
  description={caseData.description}
  documentsCount={caseData.documents.length}
  contractsCount={linkedContracts?.length ?? 0}
  stageTaskTemplates={stageTaskTemplatesList}
  opposingParty={caseData.opposingParty}
  opposingCounsel={caseData.opposingCounsel}
/>
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/case-overview.tsx src/app/\(app\)/cases/\[id\]/page.tsx
git commit -m "feat: display opposing party in case detail overview"
```

---

### Task 10: Conflict check warning on client creation

**Files:**
- Modify: `src/components/clients/client-form.tsx`
- Modify: `src/components/clients/quick-create-client-dialog.tsx`

- [ ] **Step 1: Add conflict check to client-form.tsx**

In `src/components/clients/client-form.tsx`, add `useRef` to the React import:

```ts
import { useState, useRef } from "react";
```

Add `AlertTriangle` to the lucide import:

```ts
import { Loader2, AlertTriangle } from "lucide-react";
```

Add state and debounced check logic after existing state:

```ts
const [conflictName, setConflictName] = useState("");
const conflictCheck = trpc.clients.checkConflict.useQuery(
  { name: conflictName },
  { enabled: conflictName.length >= 2 },
);

// Debounce: update conflictName 500ms after name changes (useRef to avoid extra re-renders)
const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const triggerConflictCheck = (name: string) => {
  if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
  conflictTimerRef.current = setTimeout(() => setConflictName(name), 500);
};
```

For individual: on the `lastName` input, add:
```ts
onBlur={() => {
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName.length >= 2) triggerConflictCheck(fullName);
}}
```

For organization: on the `companyName` input, add:
```ts
onBlur={() => {
  if (companyName.trim().length >= 2) triggerConflictCheck(companyName.trim());
}}
```

Add warning banner JSX just before the Create Client `<Button>`:

```tsx
{conflictCheck.data?.matches && conflictCheck.data.matches.length > 0 && (
  <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3">
    <div className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
      <div className="space-y-1 text-sm">
        <p className="font-medium text-yellow-500">Potential conflict of interest</p>
        {conflictCheck.data.matches.map((m) => (
          <p key={m.caseId} className="text-muted-foreground">
            &ldquo;{m.opposingParty || m.opposingCounsel}&rdquo; in case{" "}
            <span className="font-medium">{m.caseName}</span>
            {m.clientDisplayName && <> (client: {m.clientDisplayName})</>}
          </p>
        ))}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: Add same logic to quick-create-client-dialog.tsx**

Apply the same pattern to `src/components/clients/quick-create-client-dialog.tsx`:
- Add `useRef` to React import, `AlertTriangle` to lucide import
- Same `conflictName` state + `conflictTimerRef` useRef + `triggerConflictCheck` + `conflictCheck` query
- For individual: `onBlur` on `lastName` input triggers check with `${firstName} ${lastName}`
- For organization: `onBlur` on `companyName` input triggers check
- Warning banner before the Create button inside the dialog (same JSX as client-form)

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/client-form.tsx src/components/clients/quick-create-client-dialog.tsx
git commit -m "feat: add conflict of interest warning to client creation forms"
```

---

### Task 11: Portal — lawyer profile card on dashboard

**Files:**
- Modify: `src/app/(portal)/portal/(authenticated)/page.tsx`
- Create: `src/components/portal/lawyer-profile-card.tsx`

- [ ] **Step 1: Create lawyer profile card component**

Create `src/components/portal/lawyer-profile-card.tsx`:

```tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, MapPin, Scale } from "lucide-react";
import { PRACTICE_AREA_LABELS } from "@/lib/constants";

export function LawyerProfileCard() {
  const { data: lawyer } = trpc.portalLawyer.getProfile.useQuery();

  if (!lawyer) return null;

  return (
    <Card>
      <CardContent className="flex items-start gap-4 pt-6">
        {lawyer.avatarUrl ? (
          <img
            src={lawyer.avatarUrl}
            alt={lawyer.name}
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
            {lawyer.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 space-y-1">
          <h3 className="text-lg font-semibold">{lawyer.name}</h3>
          {lawyer.bio && (
            <p className="text-sm text-muted-foreground line-clamp-3">{lawyer.bio}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {lawyer.jurisdiction && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {lawyer.jurisdiction}
              </span>
            )}
            {lawyer.barNumber && (
              <span className="flex items-center gap-1">
                <Scale className="h-3 w-3" /> Bar #{lawyer.barNumber}
                {lawyer.barState && ` (${lawyer.barState})`}
              </span>
            )}
          </div>
          {lawyer.practiceAreas && (lawyer.practiceAreas as string[]).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {(lawyer.practiceAreas as string[]).slice(0, 4).map((area) => (
                <span key={area} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {PRACTICE_AREA_LABELS[area] ?? area}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add to portal dashboard page**

In `src/app/(portal)/portal/(authenticated)/page.tsx`, add import:

```ts
import { LawyerProfileCard } from "@/components/portal/lawyer-profile-card";
```

Add `<LawyerProfileCard />` after the `<h1>` and before `<DashboardStats />`.

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/lawyer-profile-card.tsx src/app/\(portal\)/portal/\(authenticated\)/page.tsx
git commit -m "feat: add lawyer profile card to portal dashboard"
```

---

### Task 12: Portal sidebar — lawyer avatar

**Files:**
- Modify: `src/components/portal/portal-sidebar.tsx`

- [ ] **Step 1: Add lawyer avatar to sidebar**

In `src/components/portal/portal-sidebar.tsx`, add a query for the lawyer profile:

```ts
const { data: lawyer } = trpc.portalLawyer.getProfile.useQuery();
```

Replace the static header section (the `<div className="px-4 py-6">` block) with:

```tsx
<div className="px-4 py-6">
  <div className="flex items-center gap-3">
    {lawyer?.avatarUrl ? (
      <img src={lawyer.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
    ) : null}
    <div>
      <Link href="/portal" className="text-xl font-bold tracking-tight">
        ClearTerms
      </Link>
      <p className="text-xs text-muted-foreground mt-0.5">Client Portal</p>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Run tsc to verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/portal/portal-sidebar.tsx
git commit -m "feat: show lawyer avatar in portal sidebar"
```

---

### Task 13: Generate migration and build

**Files:**
- Generated: `src/server/db/migrations/` (new migration file)

- [ ] **Step 1: Generate migration**

Run: `npm run db:generate`
Expected: new migration SQL file created

- [ ] **Step 2: Verify the migration SQL**

Check the generated SQL contains:
- `ALTER TABLE users ADD COLUMN bio text`
- `ALTER TABLE users ADD COLUMN bar_number text`
- `ALTER TABLE users ADD COLUMN bar_state text`
- `ALTER TABLE users ADD COLUMN avatar_url text`
- `ALTER TABLE users ADD COLUMN signature_image_url text`
- `ALTER TABLE cases ADD COLUMN opposing_party text`
- `ALTER TABLE cases ADD COLUMN opposing_counsel text`
- A SQL comment on `bar_state` clarifying: `-- bar_state = state of bar admission; state = practice state`

If the generated migration lacks this comment, manually add it after the `ADD COLUMN bar_state` line.

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: build succeeds, all pages compile

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/
git commit -m "chore: generate migration for lawyer profiles and opposing party columns"
```

---

### Task 14: Smoke test

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify /settings loads with new Professional Profile card**

Open `/settings` — should show the new Professional Profile card with avatar upload, bio, bar number, bar state, signature fields.

- [ ] **Step 3: Verify /portal/login loads**

Open `/portal/login` — should render login form (200 OK).

- [ ] **Step 4: Stop dev server**
