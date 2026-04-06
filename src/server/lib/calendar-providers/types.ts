export interface ExternalEvent {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
}

export interface CalendarProvider {
  createCalendar(name: string): Promise<{ calendarId: string }>;
  deleteCalendar(calendarId: string): Promise<void>;
  createEvent(calendarId: string, event: ExternalEvent): Promise<{ externalEventId: string }>;
  updateEvent(calendarId: string, externalEventId: string, event: ExternalEvent): Promise<void>;
  deleteEvent(calendarId: string, externalEventId: string): Promise<void>;
  refreshToken(): Promise<{ accessToken: string; expiresAt: Date }>;
  revokeToken(): Promise<void>;
}
