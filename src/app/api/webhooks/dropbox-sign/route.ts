// src/app/api/webhooks/dropbox-sign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { EsignatureService } from "@/server/services/esignature/service";
import { DropboxSignClient } from "@/server/services/esignature/dropbox-sign-client";
import { getPageCount } from "@/server/services/esignature/pdf-page-count";
import { verifyHellosignEventHash } from "@/server/services/esignature/webhook-verify";
import { getObject } from "@/server/services/s3";
import { decrypt } from "@/server/lib/crypto";
import { db } from "@/server/db";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { cases } from "@/server/db/schema/cases";
import { organizations } from "@/server/db/schema/organizations";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchS3ToBuffer(s3Key: string): Promise<Buffer> {
  const { body } = await getObject(s3Key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((u) => Buffer.from(u)));
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: any;
  try {
    if (rawBody.startsWith("json=")) {
      body = JSON.parse(decodeURIComponent(rawBody.slice(5)));
    } else {
      body = JSON.parse(rawBody);
    }
  } catch (e) {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const evt = body.event;
  const sr = body.signature_request;
  if (!evt?.event_hash || !sr?.signature_request_id) {
    return NextResponse.json({ status: "no-parent" }, { status: 200 });
  }

  const [request] = await db
    .select({ id: caseSignatureRequests.id, caseId: caseSignatureRequests.caseId })
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.hellosignRequestId, sr.signature_request_id))
    .limit(1);
  if (!request) {
    return NextResponse.json({ status: "no-parent" }, { status: 200 });
  }

  const [caseRow] = await db
    .select({ orgId: cases.orgId })
    .from(cases)
    .where(eq(cases.id, request.caseId))
    .limit(1);
  if (!caseRow?.orgId) return NextResponse.json({ status: "no-parent" }, { status: 200 });

  const [org] = await db
    .select({ key: organizations.hellosignApiKeyEncrypted })
    .from(organizations)
    .where(eq(organizations.id, caseRow.orgId))
    .limit(1);
  if (!org?.key) {
    console.warn("[dropbox-sign-webhook] org has no api key", { requestId: request.id });
    return NextResponse.json({ error: "unconfigured org" }, { status: 401 });
  }
  const apiKey = decrypt(org.key);

  const verified = verifyHellosignEventHash({
    apiKey,
    eventTime: String(evt.event_time),
    eventType: evt.event_type,
    eventHash: evt.event_hash,
  });
  if (!verified) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const svc = new EsignatureService({
    decryptKey: decrypt,
    getPageCount,
    fetchS3: fetchS3ToBuffer,
    buildClient: (k: string) => new DropboxSignClient({ apiKey: k }),
  });

  try {
    const result = await svc.ingestEvent(body);

    if (evt.event_type === "signature_request_all_signed" && result.status === "ok") {
      try {
        await svc.completeRequest({ requestId: request.id, apiKey });
      } catch (e) {
        console.error("[dropbox-sign-webhook] completeRequest failed", e);
      }
    }
  } catch (e) {
    console.error("[dropbox-sign-webhook] ingest failed", e);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }

  return new NextResponse("Hello API Event Received", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}
