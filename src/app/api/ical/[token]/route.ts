import { db } from "@/server/db";
import { icalFeeds } from "@/server/db/schema/ical-feeds";
import { icalFeedPreferences } from "@/server/db/schema/ical-feed-preferences";
import { caseCalendarEvents } from "@/server/db/schema/case-calendar-events";
import { eq, and, inArray, gte, lte } from "drizzle-orm";
import { generateIcalFeed } from "@/server/lib/ical-generator";
import { addMonths, subMonths } from "date-fns";

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 60; // requests per hour
const RATE_WINDOW = 3600_000; // 1 hour in ms

function isRateLimited(token: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(token) ?? []).filter((t) => now - t < RATE_WINDOW);
  if (timestamps.length >= RATE_LIMIT) return true;
  timestamps.push(now);
  rateLimitMap.set(token, timestamps);
  return false;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (isRateLimited(token)) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  const [feed] = await db.select().from(icalFeeds).where(eq(icalFeeds.token, token));
  if (!feed) return new Response("Not found", { status: 404 });
  if (!feed.enabled) return new Response("Feed disabled", { status: 403 });

  // Load preferences
  const prefs = await db.select().from(icalFeedPreferences).where(eq(icalFeedPreferences.feedId, feed.id));
  if (prefs.length === 0) {
    const empty = generateIcalFeed([]);
    return new Response(empty, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-store, private",
      },
    });
  }

  // Load events within ±6 months filtered by preferences
  const now = new Date();
  const from = subMonths(now, 6);
  const to = addMonths(now, 6);
  const caseIds = prefs.map((p) => p.caseId);

  const events = await db
    .select()
    .from(caseCalendarEvents)
    .where(
      and(
        inArray(caseCalendarEvents.caseId, caseIds),
        gte(caseCalendarEvents.startsAt, from),
        lte(caseCalendarEvents.startsAt, to),
      ),
    );

  // Filter by kinds per case
  const prefMap = new Map(prefs.map((p) => [p.caseId, p.kinds as string[]]));
  const filtered = events.filter((e) => {
    const allowedKinds = prefMap.get(e.caseId);
    return allowedKinds?.includes(e.kind);
  });

  const ical = generateIcalFeed(
    filtered.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      description: e.description,
      location: e.location,
      kind: e.kind,
      caseId: e.caseId,
    })),
  );

  return new Response(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store, private",
    },
  });
}
