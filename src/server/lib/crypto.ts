import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(version: number): Buffer {
  const currentVersion = Number(process.env.CALENDAR_ENCRYPTION_KEY_VERSION ?? "1");
  if (version === currentVersion) {
    return Buffer.from(process.env.CALENDAR_ENCRYPTION_KEY!, "hex");
  }
  if (version === currentVersion - 1 && process.env.CALENDAR_ENCRYPTION_KEY_PREV) {
    return Buffer.from(process.env.CALENDAR_ENCRYPTION_KEY_PREV, "hex");
  }
  throw new Error(`No key available for encryption key version ${version}`);
}

export function encrypt(plaintext: string): string {
  const version = Number(process.env.CALENDAR_ENCRYPTION_KEY_VERSION ?? "1");
  const key = getKey(version);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${version}:${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decrypt(encrypted: string): string {
  const [versionStr, ivHex, ciphertextHex, authTagHex] = encrypted.split(":");
  const version = Number(versionStr);
  const key = getKey(version);
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
