-- src/server/db/migrations/0035_exhibit_lists.sql
-- Phase 3.2.2 — Trial Prep / Trial Exhibit List.
-- A trial exhibit list is a court-required pretrial document identifying each
-- exhibit a party intends to offer at trial, with admission tracking. Distinct
-- from `case_filing_package_exhibits` (which are PDF attachments bundled into
-- a motion's filing package) — these are pretrial-phase identifications used
-- at trial to track whether each exhibit was admitted, objected to, etc.
-- See Fed. R. Civ. P. 26(a)(3)(A)(iii).

CREATE TABLE case_exhibit_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  serving_party text NOT NULL,
  list_number int NOT NULL DEFAULT 1,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  finalized_at timestamptz,
  served_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_exhibit_lists_serving_party_check
    CHECK (serving_party IN ('plaintiff','defendant')),
  CONSTRAINT case_exhibit_lists_status_check
    CHECK (status IN ('draft','final','served','closed')),
  CONSTRAINT case_exhibit_lists_list_number_check
    CHECK (list_number BETWEEN 1 AND 99),
  CONSTRAINT case_exhibit_lists_case_party_number_unique
    UNIQUE (case_id, serving_party, list_number)
);
CREATE INDEX case_exhibit_lists_case_idx ON case_exhibit_lists(case_id, status);

CREATE TABLE case_exhibits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES case_exhibit_lists(id) ON DELETE cascade,
  exhibit_order int NOT NULL,
  exhibit_label text NOT NULL,
  description text NOT NULL,
  doc_type text NOT NULL DEFAULT 'document',
  exhibit_date date,
  sponsoring_witness_id uuid REFERENCES case_witnesses(id) ON DELETE SET NULL,
  sponsoring_witness_name text,
  admission_status text NOT NULL DEFAULT 'proposed',
  bates_range text,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_exhibits_doc_type_check
    CHECK (doc_type IN ('document','photo','video','audio','physical','demonstrative','electronic')),
  CONSTRAINT case_exhibits_admission_status_check
    CHECK (admission_status IN ('proposed','pre_admitted','admitted','not_admitted','withdrawn','objected')),
  CONSTRAINT case_exhibits_order_check
    CHECK (exhibit_order BETWEEN 1 AND 9999),
  CONSTRAINT case_exhibits_list_order_unique
    UNIQUE (list_id, exhibit_order),
  CONSTRAINT case_exhibits_list_label_unique
    UNIQUE (list_id, exhibit_label)
);
CREATE INDEX case_exhibits_list_idx ON case_exhibits(list_id, exhibit_order);
