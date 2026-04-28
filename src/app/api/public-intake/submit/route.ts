// Unauthenticated submission endpoint for public intake forms (Phase 3.11).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { PublicIntakeTemplatesService } from "@/server/services/public-intake/templates-service";
import { PublicIntakeSubmissionsService } from "@/server/services/public-intake/submissions-service";
import { publicIntakeRateLimiter } from "@/server/services/public-intake/rate-limit";

const bodySchema = z.object({
  orgSlug: z.string().min(1).max(120),
  templateSlug: z.string().min(1).max(64),
  submitterName: z.string().max(200).optional(),
  submitterEmail: z.string().email().max(200).optional().or(z.literal("")),
  submitterPhone: z.string().max(40).optional(),
  answers: z.record(z.string(), z.unknown()),
  honeypot: z.string().max(500).optional(),
});

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  const ip = getClientIp(req);
  if (!publicIntakeRateLimiter.checkAndRecord(ip)) {
    return NextResponse.json(
      { error: "Too many submissions from your network. Please try again later." },
      { status: 429 },
    );
  }

  const templatesSvc = new PublicIntakeTemplatesService();
  const lookup = await templatesSvc.getBySlug(input.orgSlug, input.templateSlug);
  if (!lookup) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  const { template } = lookup;

  const submissionsSvc = new PublicIntakeSubmissionsService();
  try {
    const result = await submissionsSvc.recordSubmission({
      orgId: template.orgId,
      templateId: template.id,
      submitterName: input.submitterName?.trim() || undefined,
      submitterEmail: (input.submitterEmail && input.submitterEmail.length > 0) ? input.submitterEmail.trim() : undefined,
      submitterPhone: input.submitterPhone?.trim() || undefined,
      answers: input.answers,
      honeypotValue: input.honeypot,
      sourceIp: ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    // Return success even when honeypot tripped, so bots can't detect detection.
    return NextResponse.json({
      ok: true,
      submissionId: result.submissionId,
      thankYouMessage: template.thankYouMessage ?? null,
    });
  } catch (err) {
    const message = (err as { message?: string }).message ?? "Submission failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
