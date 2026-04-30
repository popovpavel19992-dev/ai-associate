import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { calendarConnections } from "@/server/db/schema/calendar-connections";
import { icalFeeds } from "@/server/db/schema/ical-feeds";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { encrypt } from "@/server/lib/crypto";
import { inngest } from "@/server/inngest/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state");

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state")?.value;

  if (!storedState || !stateParam || storedState !== stateParam) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }

  cookieStore.delete("oauth_state");

  const code = url.searchParams.get("code");
  if (!code) {
    return Response.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const env = getEnv();
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/outlook/callback`;

  const tokenResponse = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
  );

  if (!tokenResponse.ok) {
    return Response.json({ error: "Token exchange failed" }, { status: 500 });
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, scope } = tokenData;

  const meResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!meResponse.ok) {
    return Response.json({ error: "Failed to fetch user profile" }, { status: 500 });
  }

  const meData = (await meResponse.json()) as {
    mail?: string;
    userPrincipalName?: string;
  };

  const providerEmail = meData.mail ?? meData.userPrincipalName ?? null;

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

  const encryptedAccessToken = encrypt(accessToken);
  const encryptedRefreshToken = encrypt(refreshToken);

  const calendarResponse = await fetch(
    "https://graph.microsoft.com/v1.0/me/calendars",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "ClearTerms" }),
    },
  );

  if (!calendarResponse.ok) {
    return Response.json({ error: "Failed to create calendar" }, { status: 500 });
  }

  const calendarData = (await calendarResponse.json()) as { id: string };
  const externalCalendarId = calendarData.id;

  const [connection] = await db
    .insert(calendarConnections)
    .values({
      userId: user.id,
      provider: "outlook",
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      providerEmail,
      externalCalendarId,
      scope,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    })
    .returning({ id: calendarConnections.id });

  await db
    .insert(icalFeeds)
    .values({
      userId: user.id,
      token: randomUUID(),
    })
    .onConflictDoNothing();

  await inngest.send({
    name: "calendar/connection.created",
    data: { connectionId: connection.id, userId: user.id },
  });
  await inngest.send({
    name: "calendar/inbound.pull",
    data: { connectionId: connection.id },
  });

  redirect("/settings/integrations");
}
