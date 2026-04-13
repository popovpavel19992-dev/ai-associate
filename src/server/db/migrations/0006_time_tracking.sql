-- 0006_time_tracking.sql
-- Phase 2.1.6: Time Tracking & Billing

-- Enums
CREATE TYPE "public"."activity_type" AS ENUM (
  'research', 'drafting', 'court_appearance', 'client_communication',
  'filing', 'review', 'travel', 'administrative', 'other'
);--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM (
  'filing_fee', 'courier', 'copying', 'expert_fee',
  'travel', 'postage', 'service_of_process', 'other'
);--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM ('draft', 'sent', 'paid', 'void');--> statement-breakpoint

-- billing_rates
CREATE TABLE billing_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  rate_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX idx_billing_rates_user_case
  ON billing_rates (user_id, COALESCE(case_id, '00000000-0000-0000-0000-000000000000'));--> statement-breakpoint

-- time_entries
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  task_id UUID REFERENCES case_tasks(id) ON DELETE SET NULL,
  activity_type activity_type NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  is_billable BOOLEAN NOT NULL DEFAULT true,
  rate_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  entry_date DATE NOT NULL,
  timer_started_at TIMESTAMPTZ,
  timer_stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX idx_time_entries_case ON time_entries (case_id, entry_date DESC);--> statement-breakpoint
CREATE INDEX idx_time_entries_user ON time_entries (user_id, entry_date DESC);--> statement-breakpoint
CREATE INDEX idx_time_entries_org ON time_entries (org_id, entry_date DESC);--> statement-breakpoint
CREATE INDEX idx_time_entries_running ON time_entries (user_id) WHERE timer_started_at IS NOT NULL AND timer_stopped_at IS NULL;--> statement-breakpoint

-- expenses
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  category expense_category NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  expense_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX idx_expenses_case ON expenses (case_id, expense_date DESC);--> statement-breakpoint

-- invoice_counters (scope_id = org_id for firms, user_id for solo — avoids NULL PK)
CREATE TABLE invoice_counters (
  scope_id UUID PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);--> statement-breakpoint

-- invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  issued_date DATE,
  due_date DATE,
  paid_date DATE,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  payment_terms TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX idx_invoices_client ON invoices (client_id, created_at DESC);--> statement-breakpoint
CREATE INDEX idx_invoices_org_status ON invoices (org_id, status);--> statement-breakpoint
CREATE UNIQUE INDEX idx_invoices_number ON invoices (org_id, invoice_number);--> statement-breakpoint

-- invoice_line_items
CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE RESTRICT,
  expense_id UUID REFERENCES expenses(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT line_item_type_check CHECK (
    (type = 'time' AND time_entry_id IS NOT NULL AND expense_id IS NULL)
    OR (type = 'expense' AND expense_id IS NOT NULL AND time_entry_id IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items (invoice_id, sort_order);--> statement-breakpoint
CREATE UNIQUE INDEX idx_invoice_line_items_time_entry
  ON invoice_line_items (time_entry_id) WHERE time_entry_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX idx_invoice_line_items_expense
  ON invoice_line_items (expense_id) WHERE expense_id IS NOT NULL;--> statement-breakpoint
