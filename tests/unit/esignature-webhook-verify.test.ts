// tests/unit/esignature-webhook-verify.test.ts
import { describe, it, expect } from "vitest";
import { verifyHellosignEventHash } from "@/server/services/esignature/webhook-verify";
import { createHmac } from "crypto";

const API_KEY = "test_api_key_xyz";
const EVENT_TIME = "1713700000";
const EVENT_TYPE = "signature_request_signed";
const EXPECTED_HASH = createHmac("sha256", API_KEY)
  .update(EVENT_TIME + EVENT_TYPE)
  .digest("hex");

describe("verifyHellosignEventHash", () => {
  it("returns true when hash matches", () => {
    expect(verifyHellosignEventHash({ apiKey: API_KEY, eventTime: EVENT_TIME, eventType: EVENT_TYPE, eventHash: EXPECTED_HASH })).toBe(true);
  });
  it("returns false when api key differs", () => {
    expect(verifyHellosignEventHash({ apiKey: "wrong_key", eventTime: EVENT_TIME, eventType: EVENT_TYPE, eventHash: EXPECTED_HASH })).toBe(false);
  });
  it("returns false when event time was tampered", () => {
    expect(verifyHellosignEventHash({ apiKey: API_KEY, eventTime: "9999999999", eventType: EVENT_TYPE, eventHash: EXPECTED_HASH })).toBe(false);
  });
  it("returns false when event type was tampered", () => {
    expect(verifyHellosignEventHash({ apiKey: API_KEY, eventTime: EVENT_TIME, eventType: "signature_request_all_signed", eventHash: EXPECTED_HASH })).toBe(false);
  });
  it("uses constant-time compare (different-length hashes never crash)", () => {
    expect(verifyHellosignEventHash({ apiKey: API_KEY, eventTime: EVENT_TIME, eventType: EVENT_TYPE, eventHash: "short" })).toBe(false);
  });
});
