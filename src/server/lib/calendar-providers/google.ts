import { google } from "googleapis";
import { addDays } from "date-fns";
import type { CalendarProvider, ExternalEvent } from "./types";

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
