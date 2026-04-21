// tests/unit/email-inbound-classify.test.ts
import { describe, it, expect } from "vitest";
import { classifyReplyKind, isBounce } from "@/server/services/email-outreach/classify";

describe("classifyReplyKind", () => {
  it("returns 'auto_reply' for Auto-Submitted=auto-replied", () => {
    expect(classifyReplyKind({ headers: { "auto-submitted": "auto-replied" }, subject: "hi" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for Precedence=bulk", () => {
    expect(classifyReplyKind({ headers: { precedence: "bulk" }, subject: "hi" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for X-Autoreply truthy", () => {
    expect(classifyReplyKind({ headers: { "x-autoreply": "yes" }, subject: "hi" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for Out of Office subject", () => {
    expect(classifyReplyKind({ headers: {}, subject: "Out of Office: John" })).toBe("auto_reply");
  });
  it("returns 'auto_reply' for Automatic Reply subject", () => {
    expect(classifyReplyKind({ headers: {}, subject: "Automatic Reply from Jane" })).toBe("auto_reply");
  });
  it("returns 'human' for a plain reply", () => {
    expect(classifyReplyKind({ headers: {}, subject: "Re: Your case update" })).toBe("human");
  });
  it("ignores Auto-Submitted=no", () => {
    expect(classifyReplyKind({ headers: { "auto-submitted": "no" }, subject: "hi" })).toBe("human");
  });
});

describe("isBounce", () => {
  it("detects Mail Delivery Failure subject", () => {
    expect(isBounce({ from: "mailer-daemon@example.com", subject: "Mail Delivery Failure", headers: {} })).toBe(true);
  });
  it("detects Undeliverable subject", () => {
    expect(isBounce({ from: "postmaster@host.com", subject: "Undeliverable: your email", headers: {} })).toBe(true);
  });
  it("detects Delivery Status Notification subject", () => {
    expect(isBounce({ from: "MAILER-DAEMON@a", subject: "Delivery Status Notification (Failure)", headers: {} })).toBe(true);
  });
  it("returns false for a normal reply", () => {
    expect(isBounce({ from: "john@client.com", subject: "Re: hello", headers: {} })).toBe(false);
  });
  it("returns false for subject that contains 'delivery' but not a bounce phrase", () => {
    expect(isBounce({ from: "john@client.com", subject: "Confirming delivery address", headers: {} })).toBe(false);
  });
});
