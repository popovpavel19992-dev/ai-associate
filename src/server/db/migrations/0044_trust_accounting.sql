-- src/server/db/migrations/0044_trust_accounting.sql
-- Phase 3.8 — Trust Accounting / IOLTA Ledger.
--
-- Three tables capturing the lifecycle of trust account activity:
--   * trust_accounts         — bank accounts (IOLTA or operating)
--   * trust_transactions     — append-only ledger; voids are reversing entries
--   * trust_reconciliations  — monthly three-way reconciliation snapshots
--
-- Compliance notes:
--   - Trust funds (account_type='iolta') must NEVER be commingled with
--     operating funds. The service layer enforces a per-client never-negative
--     rule on disbursements.
--   - Transactions are immutable. Voids leave the original row untouched and
--     create a reversing entry pointing to it via voids_transaction_id.
--   - Bank account & routing numbers are encrypted at rest by the service
--     layer using src/server/lib/crypto.ts.

CREATE TABLE trust_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  name text NOT NULL,
  account_type text NOT NULL,
  bank_name text,
  account_number_encrypted text,
  routing_number_encrypted text,
  jurisdiction text NOT NULL DEFAULT 'FEDERAL',
  beginning_balance_cents bigint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trust_accounts_type_check
    CHECK (account_type IN ('iolta','operating'))
);
CREATE INDEX trust_accounts_org_idx ON trust_accounts(org_id, is_active);

CREATE TABLE trust_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  account_id uuid NOT NULL REFERENCES trust_accounts(id) ON DELETE restrict,
  client_id uuid REFERENCES clients(id) ON DELETE restrict,
  case_id uuid REFERENCES cases(id) ON DELETE set null,
  transaction_type text NOT NULL,
  amount_cents bigint NOT NULL,
  transaction_date date NOT NULL,
  payee_name text,
  payor_name text,
  check_number text,
  wire_reference text,
  description text NOT NULL,
  authorized_by uuid REFERENCES users(id),
  voided_at timestamptz,
  void_reason text,
  voids_transaction_id uuid REFERENCES trust_transactions(id) ON DELETE set null,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trust_transactions_type_check
    CHECK (transaction_type IN ('deposit','disbursement','transfer','adjustment','interest','service_charge')),
  CONSTRAINT trust_transactions_amount_check
    CHECK (amount_cents > 0),
  CONSTRAINT trust_transactions_void_consistency_check
    CHECK ((voided_at IS NULL AND void_reason IS NULL)
           OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX trust_transactions_account_date_idx
  ON trust_transactions(account_id, transaction_date DESC);
CREATE INDEX trust_transactions_client_idx
  ON trust_transactions(client_id, transaction_date DESC);
CREATE INDEX trust_transactions_case_idx
  ON trust_transactions(case_id, transaction_date DESC);
CREATE INDEX trust_transactions_active_idx
  ON trust_transactions(account_id) WHERE voided_at IS NULL;

CREATE TABLE trust_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  account_id uuid NOT NULL REFERENCES trust_accounts(id) ON DELETE cascade,
  period_month date NOT NULL,
  bank_statement_balance_cents bigint NOT NULL,
  book_balance_cents bigint NOT NULL,
  client_ledger_sum_cents bigint NOT NULL,
  status text NOT NULL,
  notes text,
  reconciled_by uuid NOT NULL REFERENCES users(id),
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trust_reconciliations_status_check
    CHECK (status IN ('matched','discrepancy','pending')),
  CONSTRAINT trust_reconciliations_period_unique
    UNIQUE (account_id, period_month)
);
CREATE INDEX trust_reconciliations_org_idx
  ON trust_reconciliations(org_id, period_month DESC);
