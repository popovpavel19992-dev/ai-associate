-- src/server/db/migrations/0041_settlement_tracker.sql
-- Phase 3.4 — Settlement / Mediation Tracker.
--
-- Three tables capturing the lifecycle of settlement activity in a case:
--   * case_settlement_offers — offer/counter-offer history
--   * case_mediation_sessions — mediation events
--   * case_demand_letters — formal pre-litigation / pre-trial demands

CREATE TABLE case_settlement_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  offer_number int NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  offer_type text NOT NULL,
  from_party text NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  terms text,
  conditions text,
  response text NOT NULL DEFAULT 'pending',
  response_date timestamptz,
  response_notes text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_settlement_offers_type_check
    CHECK (offer_type IN ('opening_demand','opening_offer','counter_offer','final_offer','walkaway')),
  CONSTRAINT case_settlement_offers_from_party_check
    CHECK (from_party IN ('plaintiff','defendant')),
  CONSTRAINT case_settlement_offers_response_check
    CHECK (response IN ('pending','accepted','rejected','expired','withdrawn')),
  CONSTRAINT case_settlement_offers_number_check
    CHECK (offer_number BETWEEN 1 AND 999),
  CONSTRAINT case_settlement_offers_amount_check
    CHECK (amount_cents >= 0),
  CONSTRAINT case_settlement_offers_case_number_unique
    UNIQUE (case_id, offer_number)
);
CREATE INDEX case_settlement_offers_case_idx ON case_settlement_offers(case_id, offered_at DESC);

CREATE TABLE case_mediation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  session_number int NOT NULL,
  mediator_name text NOT NULL,
  mediator_firm text,
  mediator_email text,
  mediator_phone text,
  scheduled_date timestamptz NOT NULL,
  location text,
  session_type text NOT NULL DEFAULT 'initial',
  status text NOT NULL DEFAULT 'scheduled',
  outcome text NOT NULL DEFAULT 'pending',
  duration_minutes int,
  cost_cents bigint,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_mediation_sessions_type_check
    CHECK (session_type IN ('initial','continued','final')),
  CONSTRAINT case_mediation_sessions_status_check
    CHECK (status IN ('scheduled','completed','cancelled','rescheduled')),
  CONSTRAINT case_mediation_sessions_outcome_check
    CHECK (outcome IN ('pending','settled','impasse','continued')),
  CONSTRAINT case_mediation_sessions_number_check
    CHECK (session_number BETWEEN 1 AND 99),
  CONSTRAINT case_mediation_sessions_case_number_unique
    UNIQUE (case_id, session_number)
);
CREATE INDEX case_mediation_sessions_case_idx ON case_mediation_sessions(case_id, scheduled_date DESC);

CREATE TABLE case_demand_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  letter_number int NOT NULL,
  letter_type text NOT NULL,
  recipient_name text NOT NULL,
  recipient_address text,
  recipient_email text,
  demand_amount_cents bigint,
  currency text NOT NULL DEFAULT 'USD',
  deadline_date date,
  key_facts text,
  legal_basis text,
  demand_terms text,
  letter_body text,
  status text NOT NULL DEFAULT 'draft',
  sent_at timestamptz,
  sent_method text,
  response_received_at timestamptz,
  response_summary text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_demand_letters_type_check
    CHECK (letter_type IN ('initial_demand','pre_litigation','pre_trial','response_to_demand')),
  CONSTRAINT case_demand_letters_status_check
    CHECK (status IN ('draft','sent','responded','no_response','rescinded')),
  CONSTRAINT case_demand_letters_method_check
    CHECK (sent_method IS NULL OR sent_method IN ('email','mail','certified_mail','courier')),
  CONSTRAINT case_demand_letters_number_check
    CHECK (letter_number BETWEEN 1 AND 999),
  CONSTRAINT case_demand_letters_amount_check
    CHECK (demand_amount_cents IS NULL OR demand_amount_cents >= 0),
  CONSTRAINT case_demand_letters_case_number_unique
    UNIQUE (case_id, letter_number)
);
CREATE INDEX case_demand_letters_case_idx ON case_demand_letters(case_id, status);
