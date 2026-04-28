// src/server/services/trust-accounting/accounts-service.ts
//
// Phase 3.8 — Trust account CRUD service.
// Sensitive bank data (account/routing numbers) is encrypted via
// src/server/lib/crypto.ts using the calendar encryption key (current
// version pulled from env at encrypt-time). Numbers are NEVER editable
// post-creation — to change, archive the old account and create a new one.

import { and, asc, desc, eq } from "drizzle-orm";
import {
  trustAccounts,
  type TrustAccount,
  type TrustAccountType,
} from "@/server/db/schema/trust-accounts";
import { encrypt, decrypt } from "@/server/lib/crypto";

type Db = any;

/** Returns the last 4 digits of a decrypted account number, or null. */
export function maskAccountNumber(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const trimmed = plaintext.replace(/\s+/g, "");
  if (trimmed.length === 0) return null;
  const last4 = trimmed.slice(-4);
  return `••••${last4}`;
}

export interface AccountListItem extends TrustAccount {
  accountNumberMasked: string | null;
  routingNumberMasked: string | null;
}

function decorate(row: TrustAccount): AccountListItem {
  let accountMask: string | null = null;
  let routingMask: string | null = null;
  try {
    if (row.accountNumberEncrypted)
      accountMask = maskAccountNumber(decrypt(row.accountNumberEncrypted));
  } catch {
    accountMask = null;
  }
  try {
    if (row.routingNumberEncrypted)
      routingMask = maskAccountNumber(decrypt(row.routingNumberEncrypted));
  } catch {
    routingMask = null;
  }
  return { ...row, accountNumberMasked: accountMask, routingNumberMasked: routingMask };
}

export async function listAccounts(
  db: Db,
  orgId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<AccountListItem[]> {
  const where = opts.includeInactive
    ? eq(trustAccounts.orgId, orgId)
    : and(eq(trustAccounts.orgId, orgId), eq(trustAccounts.isActive, true));
  const rows = (await db
    .select()
    .from(trustAccounts)
    .where(where)
    .orderBy(desc(trustAccounts.isActive), asc(trustAccounts.name))) as TrustAccount[];
  return rows.map(decorate);
}

export async function getAccount(
  db: Db,
  orgId: string,
  accountId: string,
): Promise<AccountListItem | null> {
  const [row] = (await db
    .select()
    .from(trustAccounts)
    .where(and(eq(trustAccounts.id, accountId), eq(trustAccounts.orgId, orgId)))
    .limit(1)) as TrustAccount[];
  if (!row) return null;
  return decorate(row);
}

export interface CreateAccountInput {
  orgId: string;
  name: string;
  accountType: TrustAccountType;
  bankName?: string | null;
  accountNumber?: string | null;
  routingNumber?: string | null;
  jurisdiction?: string;
  beginningBalanceCents?: number;
  createdBy: string;
}

export async function createAccount(
  db: Db,
  input: CreateAccountInput,
): Promise<{ id: string }> {
  const accEnc = input.accountNumber ? encrypt(input.accountNumber) : null;
  const routEnc = input.routingNumber ? encrypt(input.routingNumber) : null;
  const [inserted] = (await db
    .insert(trustAccounts)
    .values({
      orgId: input.orgId,
      name: input.name,
      accountType: input.accountType,
      bankName: input.bankName ?? null,
      accountNumberEncrypted: accEnc,
      routingNumberEncrypted: routEnc,
      jurisdiction: input.jurisdiction ?? "FEDERAL",
      beginningBalanceCents: input.beginningBalanceCents ?? 0,
      createdBy: input.createdBy,
    })
    .returning({ id: trustAccounts.id })) as { id: string }[];
  return { id: inserted.id };
}

export interface UpdateAccountPatch {
  name?: string;
  jurisdiction?: string;
  bankName?: string | null;
}

/**
 * Allow only metadata edits. Account/routing numbers are immutable post-
 * creation — to change them, archive this account and create a replacement.
 */
export async function updateAccount(
  db: Db,
  orgId: string,
  accountId: string,
  patch: UpdateAccountPatch,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.jurisdiction !== undefined) set.jurisdiction = patch.jurisdiction;
  if (patch.bankName !== undefined) set.bankName = patch.bankName;
  await db
    .update(trustAccounts)
    .set(set)
    .where(and(eq(trustAccounts.id, accountId), eq(trustAccounts.orgId, orgId)));
}

/** Archive (soft-delete) an account. Hard delete is FORBIDDEN — would orphan ledger. */
export async function archiveAccount(
  db: Db,
  orgId: string,
  accountId: string,
): Promise<void> {
  await db
    .update(trustAccounts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(trustAccounts.id, accountId), eq(trustAccounts.orgId, orgId)));
}
