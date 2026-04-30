import { Client } from "@microsoft/microsoft-graph-client";
import { addDays } from "date-fns";
import type {
  CalendarProvider,
  ExternalEvent,
  InboundEvent,
  ListEventsResult,
} from "./types";

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

  async listEvents(cursor: string | null): Promise<ListEventsResult> {
    const events: InboundEvent[] = [];
    let nextLink: string | null = null;
    let deltaLink: string | null = null;

    try {
      // Microsoft Graph's calendarView/delta returns @odata.nextLink for paging
      // and @odata.deltaLink as the cursor for next sync. Initial call uses
      // startDateTime/endDateTime; subsequent calls hit the deltaLink directly.
      let url: string;
      if (cursor) {
        url = cursor;
      } else {
        const start = new Date().toISOString();
        const end = addDays(new Date(), 90).toISOString();
        url = `/me/calendarView/delta?startDateTime=${encodeURIComponent(
          start,
        )}&endDateTime=${encodeURIComponent(end)}`;
      }

      while (url) {
        // Pass the path as-is (full URL or relative). Graph SDK accepts both.
        const page = (await this.client.api(url).get()) as {
          value?: Array<Record<string, unknown>>;
          "@odata.nextLink"?: string;
          "@odata.deltaLink"?: string;
        };

        for (const item of page.value ?? []) {
          const id = item.id as string | undefined;
          if (!id) continue;
          const removed = (item as { "@removed"?: unknown })["@removed"];
          if (removed) {
            events.push({
              externalEventId: id,
              externalEtag: null,
              title: null,
              description: null,
              location: null,
              startsAt: new Date(0),
              endsAt: null,
              isAllDay: false,
              status: "cancelled",
              isDeleted: true,
              raw: item,
            });
            continue;
          }
          const start = item.start as { dateTime?: string } | undefined;
          const end = item.end as { dateTime?: string } | undefined;
          if (!start?.dateTime) continue;
          const isAllDay = (item.isAllDay as boolean | undefined) ?? false;
          const subject = (item.subject as string | undefined) ?? null;
          const body = item.body as { content?: string } | undefined;
          const location = item.location as
            | { displayName?: string }
            | undefined;
          events.push({
            externalEventId: id,
            externalEtag: ((item as { "@odata.etag"?: string })[
              "@odata.etag"
            ]) ?? null,
            title: subject,
            description: body?.content ?? null,
            location: location?.displayName ?? null,
            startsAt: new Date(start.dateTime + "Z"),
            endsAt: end?.dateTime ? new Date(end.dateTime + "Z") : null,
            isAllDay,
            status: (item.showAs as string | undefined) ?? null,
            isDeleted: false,
            raw: item,
          });
        }

        nextLink = page["@odata.nextLink"] ?? null;
        if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
        if (!nextLink) break;
        url = nextLink;
      }

      return { events, nextCursor: deltaLink, fullResyncRequired: false };
    } catch (err: unknown) {
      const status = (err as { statusCode?: number; status?: number })
        ?.statusCode ?? (err as { status?: number })?.status;
      if (status === 410) {
        return { events: [], nextCursor: null, fullResyncRequired: true };
      }
      throw err;
    }
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
