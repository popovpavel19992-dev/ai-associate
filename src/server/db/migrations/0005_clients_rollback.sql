-- Rollback for 0005_clients.sql
-- Use only on local/dev. Production rollback requires manual coordination.

ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_client_id_clients_id_fk";
DROP INDEX IF EXISTS "idx_cases_client";
ALTER TABLE "cases" DROP COLUMN IF EXISTS "client_id";

DROP TABLE IF EXISTS "client_contacts";
DROP TABLE IF EXISTS "clients";

DROP TYPE IF EXISTS "client_status";
DROP TYPE IF EXISTS "client_type";

-- pg_trgm extension intentionally NOT dropped — may be used by other features.
