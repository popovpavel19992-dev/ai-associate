import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { google } from "googleapis";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { calendarConnections } from "@/server/db/schema/calendar-connections";
import { icalFeeds } from "@/server/db/schema/ical-feeds";
import { eq } from "drizzle-orm";
import { encrypt } from "@/server/lib/crypto";
import { inngest } from "@/server/inngest/client";
import { getEnv } from "@/lib/env";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state");

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state")?.value;

  if (!storedState || !stateParam || storedState !== stateParam) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }

  // Delete the CSRF cookie after validation
  cookieStore.delete("oauth_state");

  const code = url.searchParams.get("code");
  if (!code) {
    return Response.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const env = getEnv();
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch user email from Google
  const userinfoResponse = await oauth2Client.request<{ email: string }>({
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
  });
  const providerEmail = userinfoResponse.data.email;

  // Get Clerk user and look up internal user
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

  // Encrypt tokens
  const encryptedAccessToken = encrypt(tokens.access_token!);
  const encryptedRefreshToken = encrypt(tokens.refresh_token!);

  // Create ClearTerms sub-calendar
  const calendarApi = google.calendar({ version: "v3", auth: oauth2Client });
  const newCalendar = await calendarApi.calendars.insert({
    requestBody: { summary: "ClearTerms" },
  });
  const externalCalendarId = newCalendar.data.id ?? null;

  // Insert calendar connection
  const [connection] = await db
    .insert(calendarConnections)
    .values({
      userId: user.id,
      provider: "google",
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      providerEmail: providerEmail ?? null,
      externalCalendarId,
      scope: tokens.scope ?? null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    })
    .returning({ id: calendarConnections.id });

  // Upsert ical_feeds row (insert if not exists for this user)
  await db
    .insert(icalFeeds)
    .values({
      userId: user.id,
      token: crypto.randomUUID(),
    })
    .onConflictDoNothing();

  // Dispatch Inngest event
  await inngest.send({
    name: "calendar/connection.created",
    data: { connectionId: connection.id, userId: user.id },
  });

  redirect("/settings/integrations");
}
