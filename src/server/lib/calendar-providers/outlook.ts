import { Client } from "@microsoft/microsoft-graph-client";
import type { CalendarProvider, ExternalEvent } from "./types";

export function mapToOutlookEvent(
  event: ExternalEvent,
  caseUrl: string,
): Record<string, unknown> {
  const isAllDay = !event.endsAt;
  const footer = `\n\nManaged by ClearTerms\nView in ClearTerms: ${caseUrl}`;
  const bodyContent = event.description
    ? `${event.description}${footer}`
    : `Managed by ClearTerms\nView in ClearTerms: ${caseUrl}`;

  const base: Record<string, unknown> = {
    subject: event.title,
    body: { contentType: "text", content: bodyContent },
    start: { dateTime: event.startsAt.toISOString(), timeZone: "UTC" },
    isAllDay,
  };

  if (event.location) {
    base.location = { displayName: event.location };
  }

  if (!isAllDay) {
    base.end = { dateTime: event.endsAt!.toISOString(), timeZone: "UTC" };
  } else {
    base.end = { dateTime: event.startsAt.toISOString(), timeZone: "UTC" };
  }

  return base;
}

export class OutlookCalendarProvider implements CalendarProvider {
  private client: Client;

  constructor(
    private accessToken: string,
    private refreshTokenValue: string,
    private clientId: string,
    private clientSecret: string,
  ) {
    this.client = Client.init({
      authProvider: (done) => done(null, accessToken),
    });
  }

  async createCalendar(name: string): Promise<{ calendarId: string }> {
    const res = await this.client.api("/me/calendars").post({ name });
    return { calendarId: res.id };
  }

  async deleteCalendar(calendarId: string): Promise<void> {
    await this.client.api(`/me/calendars/${calendarId}`).delete();
  }

  async createEvent(
    calendarId: string,
    event: ExternalEvent,
  ): Promise<{ externalEventId: string }> {
    const res = await this.client
      .api(`/me/calendars/${calendarId}/events`)
      .post(mapToOutlookEvent(event, ""));
    return { externalEventId: res.id };
  }

  async updateEvent(
    calendarId: string,
    externalEventId: string,
    event: ExternalEvent,
  ): Promise<void> {
    await this.client
      .api(`/me/calendars/${calendarId}/events/${externalEventId}`)
      .patch(mapToOutlookEvent(event, ""));
  }

  async deleteEvent(calendarId: string, externalEventId: string): Promise<void> {
    await this.client
      .api(`/me/calendars/${calendarId}/events/${externalEventId}`)
      .delete();
  }

  async refreshToken(): Promise<{ accessToken: string; expiresAt: Date }> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshTokenValue,
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/.default",
    });
    const res = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      { method: "POST", body: params },
    );
    const data = await res.json() as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    return { accessToken: data.access_token, expiresAt };
  }

  async revokeToken(): Promise<void> {
    // Microsoft Graph has no direct token revocation endpoint; resolve silently
  }
}
