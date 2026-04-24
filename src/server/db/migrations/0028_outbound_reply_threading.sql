-- src/server/db/migrations/0026_outbound_reply_threading.sql
-- 2.3.5d wave 1A: outbound reply threading (RFC2822 In-Reply-To / References)

ALTER TABLE case_email_outreach
  ADD COLUMN parent_reply_id uuid NULL REFERENCES case_email_replies(id) ON DELETE SET NULL;

ALTER TABLE case_email_outreach
  ADD COLUMN in_reply_to text NULL;

CREATE INDEX case_email_outreach_parent_reply_idx
  ON case_email_outreach(parent_reply_id)
  WHERE parent_reply_id IS NOT NULL;
