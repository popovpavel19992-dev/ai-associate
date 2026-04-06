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
      return new GoogleCalendarProvider(accessToken, refreshToken, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    case "outlook":
      return new OutlookCalendarProvider(accessToken, refreshToken, env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);
    default:
      throw new Error(`Unknown provider: ${connection.provider}`);
  }
}
