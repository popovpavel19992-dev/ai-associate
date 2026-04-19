-- 0009_research_other_jurisdiction.sql
-- Bug #2 fix: CourtListener returns hits from ~50 state courts that were silently dropped
-- because the COURT_MAP only knew federal + 5 first-class states. Add "other" jurisdiction
-- and "state_other" court level so unmapped (but legitimate) state-court hits land in a
-- catch-all bucket instead of being thrown away.

ALTER TYPE "public"."research_jurisdiction" ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE "public"."research_court_level" ADD VALUE IF NOT EXISTS 'state_other';
