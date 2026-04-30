import { google } from "googleapis";
import { addDays } from "date-fns";
import type {
  CalendarProvider,
  ExternalEvent,
  InboundEvent,
  ListEventsResult,
} from "./types";

export function mapToGoogleEvent(
  event: ExternalEvent,
  caseUrl: string,
): Record<string, unknown> {
  const isAllDay = !event.endsAt;
  const footer = `\n\nManaged by ClearTerms\nView in ClearTerms: ${caseUrl}`;
  const description = event.description ? `${event.description}${footer}` : `Managed by ClearTerms\nView in ClearTerms: ${caseUrl}`;

  if (isAllDay) {
    const startDate = event.startsAt.toISOString().slice(0, 10);
    const endDate = addDays(event.startsAt, 1).toISOString().slice(0, 10);
    return {
      summary: event.title,
      description,
      location: event.location,
      start: { date: startDate },
      end: { date: endDate },
    };
  }

  return {
    summary: event.title,
    description,
    location: event.location,
    start: { dateTime: event.startsAt.toISOString() },
    end: { dateTime: event.endsAt!.toISOString() },
  };
}

export class GoogleCalendarProvider implements CalendarProvider {
  private auth: InstanceType<typeof google.auth.OAuth2>;
  private calendar: ReturnType<typeof google.calendar>;

  constructor(
    private accessToken: string,
    private refreshTokenValue: string,
    private clientId: string,
    private clientSecret: string,
  ) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshTokenValue,
    });
    this.auth = oauth2Client;
    this.calendar = google.calendar({ version: "v3", auth: oauth2Client });
  }

  async createCalendar(name: string): Promise<{ calendarId: string }> {
    const res = await this.calendar.calendars.insert({
      requestBody: { summary: name },
    });
    return { calendarId: res.data.id! };
  }

  async deleteCalendar(calendarId: string): Promise<void> {
    await this.calendar.calendars.delete({ calendarId });
  }

  async createEvent(
    calendarId: string,
    event: ExternalEvent,
  ): Promise<{ externalEventId: string }> {
    const res = await this.calendar.events.insert({
      calendarId,
      requestBody: mapToGoogleEvent(event, "") as Record<string, string>,
    });
    return { externalEventId: res.data.id! };
  }

  async updateEvent(
    calendarId: string,
    externalEventId: string,
    event: ExternalEvent,
  ): Promise<void> {
    await this.calendar.events.update({
      calendarId,
      eventId: externalEventId,
      requestBody: mapToGoogleEvent(event, "") as Record<string, string>,
    });
  }

  async deleteEvent(calendarId: string, externalEventId: string): Promise<void> {
    await this.calendar.events.delete({ calendarId, eventId: externalEventId });
  }

  async listEvents(cursor: string | null): Promise<ListEventsResult> {
    // Inbound pull happens against the user's primary calendar — events the
    // user creates manually, not the ClearTerms-managed sub-calendar.
    const calendarId = "primary";
    const events: InboundEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    try {
      do {
        const res = await this.calendar.events.list({
          calendarId,
          singleEvents: true,
          showDeleted: true,
          maxResults: 250,
          pageToken,
          // Initial sync: events from now to +90 days. Subsequent calls pass
          // syncToken which Google validates as superseding timeMin/timeMax.
          ...(cursor
            ? { syncToken: cursor }
            : {
                timeMin: new Date().toISOString(),
                timeMax: addDays(new Date(), 90).toISOString(),
              }),
        });

        const data = res.data;
        for (const item of data.items ?? []) {
          const startDateTime = item.start?.dateTime ?? item.start?.date;
          if (!startDateTime) continue;
          const endDateTime = item.end?.dateTime ?? item.end?.date;
          const isAllDay = !!item.start?.date && !item.start?.dateTime;
          events.push({
            externalEventId: item.id!,
            externalEtag: item.etag ?? null,
            title: item.summary ?? null,
            description: item.description ?? null,
            location: item.location ?? null,
            startsAt: new Date(startDateTime),
            endsAt: endDateTime ? new Date(endDateTime) : null,
            isAllDay,
            status: item.status ?? null,
            isDeleted: item.status === "cancelled",
            raw: item,
          });
        }

        pageToken = data.nextPageToken ?? undefined;
        if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
      } while (pageToken);

      return { events, nextCursor: nextSyncToken, fullResyncRequired: false };
    } catch (err: unknown) {
      // Google returns 410 GONE when syncToken is invalidated (e.g., > 7 days
      // unused). Caller should clear cursor and retry from scratch.
      const status = (err as { code?: number; status?: number })?.code ??
        (err as { status?: number })?.status;
      if (status === 410) {
        return { events: [], nextCursor: null, fullResyncRequired: true };
      }
      throw err;
    }
  }

  async refreshToken(): Promise<{ accessToken: string; expiresAt: Date }> {
    const { credentials } = await this.auth.refreshAccessToken();
    return {
      accessToken: credentials.access_token!,
      expiresAt: new Date(credentials.expiry_date!),
    };
  }

  async revokeToken(): Promise<void> {
    await this.auth.revokeToken(this.accessToken);
  }
}
