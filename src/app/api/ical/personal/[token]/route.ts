// src/app/api/ical/personal/[token]/route.ts
//
// Personal multi-case iCal feed. Token-only auth (no Clerk session) — calendar
// apps subscribe via plain HTTP. Token is hashed at rest; the path parameter
// is hashed and compared against users.ical_token_hash.

import { db } from "@/server/db";
import {
  buildPersonalFeed,
  findUserByToken,
} from "@/server/services/calendar-export/service";

// In-memory rate limit (60 req/hour/token). Mirrors the per-case feed.
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 60;
const RATE_WINDOW = 3600_000;

function isRateLimited(token: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(token) ?? []).filter(
    (t) => now - t < RATE_WINDOW,
  );
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

  const user = await findUserByToken(db, token);
  if (!user) {
    return new Response("Not found", { status: 404 });
  }

  const ics = await buildPersonalFeed(db, {
    id: user.id,
    orgId: user.orgId,
    name: user.name,
    role: user.role,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
