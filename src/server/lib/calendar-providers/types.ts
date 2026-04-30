export interface ExternalEvent {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
}

export interface InboundEvent {
  externalEventId: string;
  externalEtag?: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  isAllDay: boolean;
  status: string | null;
  isDeleted: boolean;
  raw: unknown;
}

export interface ListEventsResult {
  events: InboundEvent[];
  nextCursor: string | null;
  fullResyncRequired: boolean;
}

export interface CalendarProvider {
  createCalendar(name: string): Promise<{ calendarId: string }>;
  deleteCalendar(calendarId: string): Promise<void>;
  createEvent(calendarId: string, event: ExternalEvent): Promise<{ externalEventId: string }>;
  updateEvent(calendarId: string, externalEventId: string, event: ExternalEvent): Promise<void>;
  deleteEvent(calendarId: string, externalEventId: string): Promise<void>;
  /**
   * Incremental list of events on the user's primary calendar.
   * Pass cursor (syncToken / deltaLink) returned by previous call.
   * If null cursor, performs initial full sync over the next ~90 days.
   */
  listEvents(cursor: string | null): Promise<ListEventsResult>;
  refreshToken(): Promise<{ accessToken: string; expiresAt: Date }>;
  revokeToken(): Promise<void>;
}
