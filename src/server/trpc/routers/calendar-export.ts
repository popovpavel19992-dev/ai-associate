// src/server/trpc/routers/calendar-export.ts
//
// Personal iCal token lifecycle: status, generate, revoke. Phase 3.5.
//
// generateToken returns the plaintext URL ONCE — the hash is what we store.
// The client must show + let the user copy it before navigation; if they
// lose it, they regenerate (which silently invalidates the previous token).

import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { users } from "@/server/db/schema/users";
import {
  generateAndStoreToken,
  revokeToken,
} from "@/server/services/calendar-export/service";

function buildSubscribeUrl(plainToken: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.clearterms.com";
  return `${base}/api/ical/personal/${plainToken}`;
}

export const calendarExportRouter = router({
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        hasToken: users.icalTokenHash,
        createdAt: users.icalTokenCreatedAt,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    return {
      hasToken: Boolean(row?.hasToken),
      createdAt: row?.createdAt ?? null,
    };
  }),

  generateToken: protectedProcedure.mutation(async ({ ctx }) => {
    const { plainToken } = await generateAndStoreToken(ctx.db, ctx.user.id);
    return {
      token: plainToken,
      subscribeUrl: buildSubscribeUrl(plainToken),
    };
  }),

  revokeToken: protectedProcedure.mutation(async ({ ctx }) => {
    await revokeToken(ctx.db, ctx.user.id);
    return { success: true };
  }),
});
