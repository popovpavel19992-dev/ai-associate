-- src/server/db/migrations/0042_user_ical_tokens.sql
-- Phase 3.5 — Personal multi-case iCal calendar export.
--
-- Adds two columns to users for token-based personal iCal feed authentication.
-- The token itself is stored as a SHA-256 hash; the plaintext is shown to the
-- user once at generation time and never persisted.

ALTER TABLE users ADD COLUMN ical_token_hash text;
ALTER TABLE users ADD COLUMN ical_token_created_at timestamptz;

CREATE INDEX users_ical_token_hash_idx
  ON users(ical_token_hash)
  WHERE ical_token_hash IS NOT NULL;
