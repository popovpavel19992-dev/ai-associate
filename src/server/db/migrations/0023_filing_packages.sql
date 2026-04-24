-- src/server/db/migrations/0023_filing_packages.sql
CREATE TABLE case_filing_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  motion_id uuid REFERENCES case_motions(id) ON DELETE set null,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  proposed_order_text text,
  cover_sheet_data jsonb NOT NULL,
  exported_pdf_path text,
  exported_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_filing_packages_status_check CHECK (status IN ('draft','finalized'))
);

CREATE INDEX case_filing_packages_case_idx ON case_filing_packages(case_id);
CREATE INDEX case_filing_packages_motion_idx ON case_filing_packages(motion_id);
CREATE INDEX case_filing_packages_org_idx ON case_filing_packages(org_id);

CREATE TABLE case_filing_package_exhibits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES case_filing_packages(id) ON DELETE cascade,
  label text NOT NULL,
  display_order integer NOT NULL,
  source_type text NOT NULL,
  document_id uuid REFERENCES documents(id) ON DELETE set null,
  ad_hoc_s3_key text,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pkg_exhibits_source_check CHECK (
    source_type IN ('case_document','ad_hoc_upload') AND (
      (source_type = 'case_document' AND document_id IS NOT NULL AND ad_hoc_s3_key IS NULL)
      OR
      (source_type = 'ad_hoc_upload' AND ad_hoc_s3_key IS NOT NULL AND document_id IS NULL)
    )
  )
);

CREATE INDEX pkg_exhibits_package_order_idx ON case_filing_package_exhibits(package_id, display_order);
