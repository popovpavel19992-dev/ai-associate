// src/server/services/discovery-responses/tokens-service.ts
//
// Token lifecycle for the opposing-party Discovery Response portal (3.1.4).
// Pattern mirrors src/server/services/calendar-export/service.ts:
//   * 24 random bytes  -> 48-char lowercase hex plaintext token
//   * sha-256 hashed at rest; plaintext is shown ONCE at generation time
//   * lookup by hash via partial index `WHERE revoked_at IS NULL`

import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { discoveryResponseTokens } from "@/server/db/schema/discovery-response-tokens";

type Db = any;

const TOKEN_BYTES = 24; // 48 hex chars
const DEFAULT_EXPIRES_DAYS = 60;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export interface GenerateTokenInput {
  requestId: string;
  opposingEmail: string;
  opposingName?: string;
  expiresInDays?: number;
  now?: Date;
}

export interface GenerateTokenResult {
  tokenId: string;
  plainToken: string;
  expiresAt: Date;
}

/**
 * Generate a brand-new token for an (request, email) tuple. If a token already
 * exists for this tuple we update the row in place — old hash is overwritten,
 * any prior plaintext becomes worthless, expires_at is reset, revoked_at is
 * cleared. This makes "regenerate link" idempotent without a unique-violation.
 */
export async function generateToken(
  db: Db,
  input: GenerateTokenInput,
): Promise<GenerateTokenResult> {
  const now = input.now ?? new Date();
  const expiresInDays = input.expiresInDays ?? DEFAULT_EXPIRES_DAYS;
  const expiresAt = addDays(now, expiresInDays);

  const plainToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(plainToken);

  const [existing] = await db
    .select({ id: discoveryResponseTokens.id })
    .from(discoveryResponseTokens)
    .where(
      and(
        eq(discoveryResponseTokens.requestId, input.requestId),
        eq(discoveryResponseTokens.opposingPartyEmail, input.opposingEmail),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(discoveryResponseTokens)
      .set({
        tokenHash,
        opposingPartyName: input.opposingName ?? null,
        generatedAt: now,
        expiresAt,
        revokedAt: null,
      })
      .where(eq(discoveryResponseTokens.id, existing.id));
    return { tokenId: existing.id, plainToken, expiresAt };
  }

  const [inserted] = await db
    .insert(discoveryResponseTokens)
    .values({
      requestId: input.requestId,
      opposingPartyEmail: input.opposingEmail,
      opposingPartyName: input.opposingName ?? null,
      tokenHash,
      generatedAt: now,
      expiresAt,
    })
    .returning({ id: discoveryResponseTokens.id });

  return { tokenId: inserted.id, plainToken, expiresAt };
}

export interface TokenResolution {
  tokenId: string;
  requestId: string;
  opposingEmail: string;
  opposingName: string | null;
  expiresAt: Date;
}

export async function findByToken(
  db: Db,
  token: string,
  opts: { now?: Date } = {},
): Promise<TokenResolution | null> {
  if (!token || token.length < 8) return null;
  const now = opts.now ?? new Date();
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(discoveryResponseTokens)
    .where(
      and(
        eq(discoveryResponseTokens.tokenHash, tokenHash),
        isNull(discoveryResponseTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && new Date(row.expiresAt) < now) return null;
  return {
    tokenId: row.id,
    requestId: row.requestId,
    opposingEmail: row.opposingPartyEmail,
    opposingName: row.opposingPartyName ?? null,
    expiresAt: row.expiresAt,
  };
}

export async function revokeToken(db: Db, tokenId: string): Promise<void> {
  await db
    .update(discoveryResponseTokens)
    .set({ revokedAt: new Date() })
    .where(eq(discoveryResponseTokens.id, tokenId));
}

export async function recordAccess(db: Db, tokenId: string, now?: Date): Promise<void> {
  await db
    .update(discoveryResponseTokens)
    .set({ lastAccessedAt: now ?? new Date() })
    .where(eq(discoveryResponseTokens.id, tokenId));
}

export async function listForRequest(
  db: Db,
  requestId: string,
): Promise<{
  id: string;
  opposingPartyEmail: string;
  opposingPartyName: string | null;
  generatedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastAccessedAt: Date | null;
}[]> {
  return db
    .select({
      id: discoveryResponseTokens.id,
      opposingPartyEmail: discoveryResponseTokens.opposingPartyEmail,
      opposingPartyName: discoveryResponseTokens.opposingPartyName,
      generatedAt: discoveryResponseTokens.generatedAt,
      expiresAt: discoveryResponseTokens.expiresAt,
      revokedAt: discoveryResponseTokens.revokedAt,
      lastAccessedAt: discoveryResponseTokens.lastAccessedAt,
    })
    .from(discoveryResponseTokens)
    .where(eq(discoveryResponseTokens.requestId, requestId));
}

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://app.clearterms.com";

export function buildResponseUrl(plainToken: string): string {
  return `${APP_BASE_URL}/respond/${plainToken}`;
}
