// src/server/services/calendar-export/ical-builder.ts
//
// Hand-rolled RFC 5545 iCalendar builder for the personal multi-case feed.
// Distinct from src/server/lib/ical-generator.ts (per-case feed via the
// `ical-generator` npm package) — this one gives us explicit control over
// line folding, char escaping, and stable UIDs across event sources.

export interface IcsEvent {
  /** Stable, globally-unique identifier (becomes the UID property). */
  uid: string;
  /** Timed start; for all-day events, only the date portion is used and dtEnd is ignored. */
  dtStart: Date;
  /** End. If omitted on a timed event, defaults to start + 1 hour. */
  dtEnd?: Date;
  /** True for date-only events (deadlines, filed dates). DTSTART;VALUE=DATE. */
  allDay?: boolean;
  summary: string;
  description?: string;
  location?: string;
  /** Deep link back to the app. */
  url?: string;
}

export interface BuildIcsOptions {
  /** Used in X-WR-CALNAME (display label in the user's calendar app). */
  calendarName?: string;
  /** ISO timestamp string for DTSTAMP; defaults to "now". Useful for deterministic tests. */
  now?: Date;
}

const PRODID = "-//ClearTerms//Calendar Export//EN";

// Escape per RFC 5545 §3.3.11 TEXT.
// Order matters: backslash first.
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// RFC 5545 §3.1: lines longer than 75 octets MUST be folded by inserting a
// CRLF followed by a single linear-white-space (we use a space). We measure
// in UTF-8 octets, not characters, so multi-byte glyphs don't push past 75.
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

  const dec = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  // First chunk gets up to 75 octets, subsequent chunks get up to 74 (the
  // leading space added during fold counts toward the 75-octet limit on the
  // continuation line).
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 sequence: walk back until the byte at
    // `end` is the start of a code point (top bits are not 10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    chunks.push(dec.decode(bytes.slice(start, end)));
    start = end;
    limit = 74;
  }
  return chunks.join("\r\n ");
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function formatDateUtc(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function formatDateOnly(d: Date): string {
  // YYYYMMDD — uses UTC components so date-only events are stable regardless
  // of where the calendar app interprets them.
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function eventLines(event: IcsEvent, dtstamp: string): string[] {
  const lines: string[] = ["BEGIN:VEVENT"];
  lines.push(`UID:${event.uid}`);
  lines.push(`DTSTAMP:${dtstamp}`);

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.dtStart)}`);
    // For a single all-day event, omit DTEND so calendar apps treat it as
    // a single date (Google/Apple convention). RFC also allows DTEND one
    // day later, but omission is widely supported and simpler.
  } else {
    lines.push(`DTSTART:${formatDateUtc(event.dtStart)}`);
    const end = event.dtEnd ?? new Date(event.dtStart.getTime() + 60 * 60 * 1000);
    lines.push(`DTEND:${formatDateUtc(end)}`);
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeText(event.location)}`);
  }
  if (event.url) {
    // URL is a URI value type — not subject to TEXT escaping per RFC 5545 §3.3.13.
    lines.push(`URL:${event.url}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildIcs(events: IcsEvent[], opts: BuildIcsOptions = {}): string {
  const dtstamp = formatDateUtc(opts.now ?? new Date());
  const calName = opts.calendarName ?? "ClearTerms Calendar";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    "X-PUBLISHED-TTL:PT5M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT5M",
  ];

  for (const event of events) {
    lines.push(...eventLines(event, dtstamp));
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
