import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const state = randomUUID();

  const cookieStore = await cookies();
  cookieStore.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/auth",
  });

  const env = getEnv();
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendars",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
