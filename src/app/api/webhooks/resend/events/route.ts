// src/app/api/webhooks/resend/events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { EmailEventsIngestService, type EventPayload } from "@/server/services/email-outreach/events-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapResendEventType(raw: string): EventPayload["eventType"] | null {
  switch (raw) {
    case "email.delivered": return "delivered";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    case "email.complained": return "complained";
    case "email.bounced": return "bounced";
    default: return null;
  }
}

function toEventPayload(raw: any): EventPayload | null {
  const mapped = mapResendEventType(raw.type ?? raw.event_type ?? "");
  if (!mapped) return null;
  return {
    eventId: raw.id ?? raw.event_id,
    resendEmailId: raw.data?.email_id ?? raw.data?.emailId ?? raw.email_id,
    eventType: mapped,
    eventAt: raw.created_at ? new Date(raw.created_at) : new Date(),
    metadata: {
      url: raw.data?.click?.url ?? raw.data?.url,
      userAgent: raw.data?.click?.userAgent ?? raw.data?.open?.userAgent,
      ipAddress: raw.data?.click?.ipAddress ?? raw.data?.open?.ipAddress,
    },
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_EVENTS_WEBHOOK_SECRET ?? process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[events-webhook] RESEND_EVENTS_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const headers = {
    "webhook-id": req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("svix-signature") ?? req.headers.get("webhook-signature") ?? "",
  };

  let verified: unknown;
  try {
    const wh = new Webhook(secret);
    verified = wh.verify(rawBody, headers);
  } catch (e) {
    console.warn("[events-webhook] signature verify failed", e);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = toEventPayload(verified);
  if (!payload) {
    return NextResponse.json({ status: "skipped", reason: "unknown type" }, { status: 200 });
  }

  const svc = new EmailEventsIngestService();
  try {
    const result = await svc.ingest(payload);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error("[events-webhook] ingest failed", e);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
