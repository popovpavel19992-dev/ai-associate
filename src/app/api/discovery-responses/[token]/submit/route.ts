// src/app/api/discovery-responses/[token]/submit/route.ts
//
// Public (no Clerk) submit endpoint. Body validates with zod, the token is
// re-resolved on every call (no trust between preview and submit), and
// responses are upserted via the responses-service.
//
// `final: true` flips the parent request status to 'responses_received';
// `final: false` is a draft save (per-blur autosave from the form).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { db } from "@/server/db";
import {
  findByToken,
  recordAccess,
} from "@/server/services/discovery-responses/tokens-service";
import {
  submitResponses,
  markRequestResponsesReceived,
  ResponseValidationError,
} from "@/server/services/discovery-responses/responses-service";

const RESPONSE_TYPE = z.enum([
  "admit",
  "deny",
  "object",
  "lack_of_knowledge",
  "written_response",
  "produced_documents",
]);

const SUBMIT_SCHEMA = z.object({
  responderName: z.string().max(200).optional().nullable(),
  responderEmail: z.string().email().max(254),
  final: z.boolean().default(false),
  responses: z
    .array(
      z.object({
        questionIndex: z.number().int().min(0).max(200),
        responseType: RESPONSE_TYPE,
        responseText: z.string().max(20000).optional().nullable(),
        objectionBasis: z.string().max(20000).optional().nullable(),
        producedDocDescriptions: z.array(z.string().max(2000)).max(200).optional(),
      }),
    )
    .max(200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const resolved = await findByToken(db, token);
  if (!resolved) return new NextResponse("Not found", { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = SUBMIT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  recordAccess(db, resolved.tokenId).catch(() => {});

  // Lock the responder email to whatever was issued in the token. Prevents
  // a malicious form post from impersonating a different responder.
  const responderEmail = resolved.opposingEmail;

  try {
    const { saved } = await submitResponses(db, {
      requestId: resolved.requestId,
      tokenId: resolved.tokenId,
      responderName: parsed.data.responderName ?? resolved.opposingName ?? null,
      responderEmail,
      responses: parsed.data.responses,
    });

    if (parsed.data.final) {
      await markRequestResponsesReceived(db, resolved.requestId);
    }

    return NextResponse.json({
      ok: true,
      saved,
      finalized: parsed.data.final,
    });
  } catch (e) {
    if (e instanceof ResponseValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[discovery-responses/submit] error", e);
    return NextResponse.json({ error: "submit failed" }, { status: 500 });
  }
}
