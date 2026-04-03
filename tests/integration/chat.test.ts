import { describe, it, expect } from "vitest";
import {
  CHAT_RATE_LIMIT_PER_HOUR,
  PLAN_LIMITS,
  BANNED_WORDS,
  APPROVED_PHRASES,
  MAX_FILE_SIZE,
  AVAILABLE_SECTIONS,
} from "@/lib/constants";
import { scanForBannedWords } from "@/server/services/compliance";

describe("Chat — Rate Limiting Configuration", () => {
  it("rate limit is 30 messages per hour", () => {
    expect(CHAT_RATE_LIMIT_PER_HOUR).toBe(30);
  });

  it("trial plan has 10 messages per case", () => {
    expect(PLAN_LIMITS.trial.chatMessagesPerCase).toBe(10);
  });

  it("solo plan has 50 messages per case", () => {
    expect(PLAN_LIMITS.solo.chatMessagesPerCase).toBe(50);
  });

  it("higher plans have unlimited chat", () => {
    expect(PLAN_LIMITS.small_firm.chatMessagesPerCase).toBe(Infinity);
    expect(PLAN_LIMITS.firm_plus.chatMessagesPerCase).toBe(Infinity);
  });
});

describe("Chat — Compliance Filtering", () => {
  it("detects all defined banned words", () => {
    for (const word of BANNED_WORDS) {
      const found = scanForBannedWords(`text containing ${word} here`);
      expect(found).toContain(word);
    }
  });

  it("approved phrases do not trigger banned word detection", () => {
    for (const phrase of APPROVED_PHRASES) {
      const found = scanForBannedWords(phrase);
      expect(found.length).toBe(0);
    }
  });

  it("real-world AI response passes compliance", () => {
    const response =
      "Analysis indicates that this clause means the defendant has limited liability. " +
      "Consider the implications for the plaintiff's position. " +
      "Note that typically in similar cases, courts have ruled in favor of the defendant.";
    const found = scanForBannedWords(response);
    expect(found.length).toBeLessThan(3);
  });

  it("problematic AI response fails compliance", () => {
    const response =
      "I recommend that you should pursue this claim. " +
      "I advise filing immediately. " +
      "You must act before the deadline.";
    const found = scanForBannedWords(response);
    expect(found.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Chat — Input Validation Constants", () => {
  it("max file size is 25MB", () => {
    expect(MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
  });

  it("has 10 available analysis sections", () => {
    expect(AVAILABLE_SECTIONS.length).toBe(10);
  });

  it("all section names are lowercase with underscores", () => {
    for (const section of AVAILABLE_SECTIONS) {
      expect(section).toMatch(/^[a-z_]+$/);
    }
  });
});
