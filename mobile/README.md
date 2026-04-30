# ClearTerms Mobile (Expo)

Native iOS / Android client for ClearTerms, sharing the same tRPC API as the web app at the repo root.

## Status

**Skeleton / dev-only.** Not yet built for the App Store or Play Store. Read-only feature parity except for **Time Entry quick-add** (the only mutation in this MVP).

## Stack

- Expo SDK 52 + Expo Router (file-based navigation, typed routes)
- React Native 0.76 (New Architecture enabled)
- `@clerk/clerk-expo` for auth, with `expo-secure-store` token cache
- `@trpc/react-query` consuming the existing `AppRouter` via relative import (`../src/server/trpc/root.ts`)
- TypeScript strict

## Screens

- `(auth)/sign-in` — Clerk email + 6-digit code sign-in
- `(app)/dashboard` — KPI tiles: active cases, billed hours MTD, unread inbox
- `(app)/cases` — searchable case list + case detail (read-only)
- `(app)/notifications` — list + mark-read + mark-all-read
- `(app)/time` — quick time entry (case picker, hours, description)
- `(app)/settings` — sign out, version, API URL, open web app

## Getting started

1. Install deps:
   ```sh
   cd mobile
   npm install
   ```
2. Configure env:
   ```sh
   cp .env.example .env
   ```
   Fill in:
   - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` — copy from your root `.env.local` (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
   - `EXPO_PUBLIC_API_URL` — your dev server. For the **iOS Simulator**, `http://localhost:3000` works. For an **Android emulator**, use `http://10.0.2.2:3000`. For a **physical device**, run `npx expo start --tunnel` and point this to the LAN URL where Next.js is reachable (or expose Next via ngrok / Cloudflare tunnel).
3. Make sure the Next.js app is running at the API URL: `npm run dev` from the repo root.
4. Start Expo:
   ```sh
   npm start
   ```
   Then press:
   - `i` → iOS Simulator
   - `a` → Android emulator
   - `w` → Web preview
   - Or scan the QR with **Expo Go** on a physical device.

## Auth flow

The app sends every tRPC request with `Authorization: Bearer <Clerk JWT>`. Clerk's `auth()` helper on the Next.js side already accepts Bearer tokens out of the box (Clerk machine-auth / API-token mode), so no server change was required.

If your Clerk instance restricts Bearer tokens, add the mobile bundle ID (`app.clearterms.mobile`) as an authorized origin in the Clerk dashboard.

## Known limitations

- No native push notifications (web app uses web-push for PWA; native APNs/FCM via Expo Push deferred).
- Read-only except **Time Entry**. No document viewing, signing, or other mutations on mobile yet.
- No offline-first / sync engine — pull-to-refresh on each tab.
- `web` target is for dev preview only; ship the PWA at the repo root for production web.
- Not yet submitted to App Store or Play Store. That requires:
  - Apple Developer account + App Store Connect setup
  - Google Play Developer account
  - EAS Build configured (`eas.json`)
  - App icons / splash designed (current ones are 1024×1024 solid `#0a0a0a` placeholders)

## File layout

```
mobile/
├── app/
│   ├── _layout.tsx                 # ClerkProvider + TRPCProvider
│   ├── index.tsx                   # auth-aware redirect
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── sign-in.tsx
│   └── (app)/
│       ├── _layout.tsx             # bottom tab bar
│       ├── dashboard.tsx
│       ├── cases/
│       │   ├── _layout.tsx
│       │   ├── index.tsx
│       │   └── [id].tsx
│       ├── notifications.tsx
│       ├── time.tsx
│       └── settings.tsx
├── lib/
│   ├── clerk-token-cache.ts        # SecureStore-backed
│   ├── trpc.tsx                    # tRPC client + Bearer header
│   └── theme.ts
├── assets/                         # placeholder PNGs
├── app.json
├── babel.config.js
├── package.json
├── tsconfig.json
└── .env.example
```

## Type-sharing with the server

`mobile/lib/trpc.tsx` does:

```ts
import type { AppRouter } from '../../src/server/trpc/root';
```

Note: this is a **type-only** import — the mobile bundle never includes server code at runtime. The root `tsconfig.json` excludes `mobile/`, so adding the mobile app does not affect Next.js builds or root typecheck.
