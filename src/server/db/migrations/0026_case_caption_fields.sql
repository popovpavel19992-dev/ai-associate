-- src/server/db/migrations/0026_case_caption_fields.sql
ALTER TABLE cases ADD COLUMN plaintiff_name text;
ALTER TABLE cases ADD COLUMN defendant_name text;
ALTER TABLE cases ADD COLUMN case_number text;
ALTER TABLE cases ADD COLUMN court text;
ALTER TABLE cases ADD COLUMN district text;
