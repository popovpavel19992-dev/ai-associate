-- src/server/db/migrations/0032_rfp_template_type.sql
-- Phase 3.1.2: Tag library templates with their request type so RFPs and
-- interrogatories can share the same library table.

ALTER TABLE discovery_request_templates
  ADD COLUMN request_type text NOT NULL DEFAULT 'interrogatories';

ALTER TABLE discovery_request_templates
  ADD CONSTRAINT discovery_request_templates_request_type_check
    CHECK (request_type IN ('interrogatories','rfp','rfa'));

CREATE INDEX discovery_request_templates_request_type_idx
  ON discovery_request_templates(request_type, case_type, is_active);
