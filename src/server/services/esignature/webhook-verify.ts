// src/server/services/esignature/webhook-verify.ts
import { createHmac, timingSafeEqual } from "crypto";

export interface VerifyInput {
  apiKey: string;
  eventTime: string;
  eventType: string;
  eventHash: string;
}

export function verifyHellosignEventHash(input: VerifyInput): boolean {
  const expected = createHmac("sha256", input.apiKey)
    .update(input.eventTime + input.eventType)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(input.eventHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
