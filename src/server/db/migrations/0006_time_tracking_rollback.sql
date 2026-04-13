-- 0006_time_tracking_rollback.sql
DROP TABLE IF EXISTS invoice_line_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS invoice_counters CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS billing_rates CASCADE;
DROP TYPE IF EXISTS invoice_status;
DROP TYPE IF EXISTS expense_category;
DROP TYPE IF EXISTS activity_type;
