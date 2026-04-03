-- RLS Policies for ClearTerms Case Summarization
--
-- Auth model: Clerk JWT passed to Supabase via custom JWT template.
-- Supabase extracts `sub` (Clerk user ID) from the JWT.
-- We use auth.jwt() ->> 'sub' to get the Clerk user ID,
-- then look up the internal user via users.clerk_id.
--
-- The tRPC layer uses the service_role key (bypasses RLS),
-- so RLS protects direct Supabase client access (Realtime, client queries).

-- Enable RLS on data tables
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_presets ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's internal ID from Clerk JWT sub claim
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM users WHERE clerk_id = auth.jwt() ->> 'sub'
$$;

-- Helper: get current user's org_id
CREATE OR REPLACE FUNCTION get_current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT org_id FROM users WHERE clerk_id = auth.jwt() ->> 'sub'
$$;

-- Cases: user can access own cases or cases belonging to their org
CREATE POLICY "users_own_cases" ON cases
  FOR ALL USING (
    user_id = get_current_user_id()
    OR (org_id IS NOT NULL AND org_id = get_current_user_org_id())
  );

-- Documents: access via case ownership
CREATE POLICY "users_own_documents" ON documents
  FOR ALL USING (
    case_id IN (
      SELECT id FROM cases
      WHERE user_id = get_current_user_id()
        OR (org_id IS NOT NULL AND org_id = get_current_user_org_id())
    )
  );

-- Document analyses: access via case ownership
CREATE POLICY "users_own_analyses" ON document_analyses
  FOR ALL USING (
    case_id IN (
      SELECT id FROM cases
      WHERE user_id = get_current_user_id()
        OR (org_id IS NOT NULL AND org_id = get_current_user_org_id())
    )
  );

-- Chat messages: user can only access their own messages
CREATE POLICY "users_own_messages" ON chat_messages
  FOR ALL USING (
    user_id = get_current_user_id()
  );

-- Section presets: all authenticated users can read system presets
CREATE POLICY "read_system_presets" ON section_presets
  FOR SELECT USING (is_system = true);
