import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt } from "@/server/lib/crypto";

describe("crypto", () => {
  const TEST_KEY = "a".repeat(64);

  beforeEach(() => {
    process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY;
    process.env.CALENDAR_ENCRYPTION_KEY_VERSION = "1";
    delete process.env.CALENDAR_ENCRYPTION_KEY_PREV;
  });

  afterEach(() => {
    process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY;
    process.env.CALENDAR_ENCRYPTION_KEY_VERSION = "1";
    delete process.env.CALENDAR_ENCRYPTION_KEY_PREV;
  });

  it("encrypts and decrypts a string", () => {
    const plaintext = "sk_live_test_token_12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same_token";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it("decrypts with previous key version", () => {
    const plaintext = "refresh_token_xyz";
    const encrypted = encrypt(plaintext);
    expect(encrypted.startsWith("1:")).toBe(true);

    const prevKey = TEST_KEY;
    const newKey = "b".repeat(64);
    process.env.CALENDAR_ENCRYPTION_KEY_PREV = prevKey;
    process.env.CALENDAR_ENCRYPTION_KEY = newKey;
    process.env.CALENDAR_ENCRYPTION_KEY_VERSION = "2";

    expect(decrypt(encrypted)).toBe(plaintext);

    const newEncrypted = encrypt("new_token");
    expect(newEncrypted.startsWith("2:")).toBe(true);
    expect(decrypt(newEncrypted)).toBe("new_token");
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("secret");
    const parts = encrypted.split(":");
    parts[2] = "ff" + parts[2].slice(2);
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});
