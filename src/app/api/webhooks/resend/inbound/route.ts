// src/app/api/webhooks/resend/inbound/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { EmailInboundService, type InboundPayload } from "@/server/services/email-outreach/inbound";
import { putObject } from "@/server/services/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInboundPayload(raw: any): InboundPayload {
  const recipientList: string[] = Array.isArray(raw.to) ? raw.to : [raw.to].filter(Boolean);
  return {
    eventId: raw.id ?? raw.event_id,
    to: recipientList,
    from: {
      email: raw.from?.email ?? raw.from,
      name: raw.from?.name,
    },
    subject: raw.subject ?? "",
    text: raw.text,
    html: raw.html,
    headers: raw.headers ?? {},
    messageId: raw.message_id,
    inReplyTo: raw.in_reply_to,
    receivedAt: raw.received_at ? new Date(raw.received_at) : new Date(),
    attachments: (raw.attachments ?? []).map((a: any) => ({
      filename: a.filename,
      contentType: a.content_type ?? a.contentType,
      size: a.size ?? (a.content ? Buffer.from(a.content, "base64").length : 0),
      content: a.content ? Buffer.from(a.content, "base64") : Buffer.alloc(0),
      contentId: a.content_id ?? a.contentId,
    })),
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[inbound-webhook] RESEND_INBOUND_WEBHOOK_SECRET not set");
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
    console.warn("[inbound-webhook] signature verify failed", e);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: InboundPayload;
  try {
    payload = toInboundPayload(verified);
  } catch (e) {
    console.error("[inbound-webhook] payload shape error", e);
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const svc = new EmailInboundService({
    putObject,
    // enqueueExternalEmail wired in T13
  });

  try {
    const result = await svc.ingest(payload);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error("[inbound-webhook] ingest failed", e);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
