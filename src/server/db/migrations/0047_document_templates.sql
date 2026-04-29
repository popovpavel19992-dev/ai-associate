-- src/server/db/migrations/0047_document_templates.sql
-- Phase 3.12 — Firm Document Templates Engine.
--
--   * document_templates         — global + per-org reusable document templates
--   * case_generated_documents   — instances rendered from templates within
--                                  a case or directly under a client
--
-- Naming note: a `documents` table already exists for uploaded files (see
-- 0000_mighty_scalphunter.sql). We deliberately use `case_generated_documents`
-- to avoid collision and to make the templated-doc origin clear in queries.

CREATE TABLE document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,    -- NULL = global library
  category text NOT NULL,
  name text NOT NULL,
  description text,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  is_global boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (category IN ('retainer','engagement','fee_agreement','nda','conflict_waiver','termination','demand','settlement','authorization','other'))
);
CREATE INDEX document_templates_lookup_idx
  ON document_templates(org_id, category, is_active);

CREATE TABLE case_generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid REFERENCES cases(id) ON DELETE cascade,
  client_id uuid REFERENCES clients(id) ON DELETE cascade,
  template_id uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  category text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  variables_filled jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  finalized_at timestamptz,
  sent_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('draft','finalized','sent','superseded')),
  CHECK ((case_id IS NOT NULL) OR (client_id IS NOT NULL))
);
CREATE INDEX case_generated_documents_case_idx
  ON case_generated_documents(case_id, created_at DESC);
CREATE INDEX case_generated_documents_client_idx
  ON case_generated_documents(client_id, created_at DESC);
CREATE INDEX case_generated_documents_org_idx
  ON case_generated_documents(org_id, created_at DESC);
