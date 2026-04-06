import ical from "ical-generator";

interface IcalEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  description?: string | null;
  location?: string | null;
  kind: string;
  caseId: string;
}

export function generateIcalFeed(events: IcalEvent[]): string {
  const calendar = ical({
    name: "ClearTerms",
    prodId: { company: "ClearTerms", product: "Calendar" },
    ttl: 30 * 60,
  });

  for (const event of events) {
    const isAllDay = !event.endsAt;
    calendar.createEvent({
      id: `${event.id}@clearterms.app`,
      summary: event.title,
      start: event.startsAt,
      ...(isAllDay ? { allDay: true } : { end: event.endsAt! }),
      description: [event.description, "", `Kind: ${event.kind}`, "Managed by ClearTerms"].filter((s) => s != null).join("\n"),
      location: event.location ?? undefined,
    });
  }

  const raw = calendar.toString();
  return raw.replace(
    "X-PUBLISHED-TTL:PT30M",
    "X-PUBLISHED-TTL:PT30M\r\nREFRESH-INTERVAL;VALUE=DURATION:PT30M",
  );
}
