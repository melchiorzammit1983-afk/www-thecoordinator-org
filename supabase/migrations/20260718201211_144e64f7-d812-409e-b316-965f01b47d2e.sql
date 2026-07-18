
-- 1) Add retracted_at to trip_messages for reversible "message" undos.
ALTER TABLE public.trip_messages
  ADD COLUMN IF NOT EXISTS retracted_at timestamptz;

-- 2) Audit table.
CREATE TABLE IF NOT EXISTS public.ai_action_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  actor_user_id uuid,
  action_kind text NOT NULL CHECK (action_kind IN (
    'create','update','search_update','data_fix','group','ungroup','message','partner_suggest'
  )),
  target_table text NOT NULL,
  target_id uuid,
  target_ids uuid[],
  before_state jsonb,
  after_state jsonb,
  summary text,
  raw_message text,
  undone_at timestamptz,
  undo_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_action_audit_company_created_idx
  ON public.ai_action_audit (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_action_audit_target_idx
  ON public.ai_action_audit (target_id);

GRANT SELECT, INSERT, UPDATE ON public.ai_action_audit TO authenticated;
GRANT ALL ON public.ai_action_audit TO service_role;

ALTER TABLE public.ai_action_audit ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the owning company.
CREATE POLICY "ai_action_audit_select_company"
  ON public.ai_action_audit FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
    )
  );

-- Insert: only for own company; actor must be the caller (or null for system).
CREATE POLICY "ai_action_audit_insert_company"
  ON public.ai_action_audit FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
    )
    AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
  );

-- Update (used to mark undone_at): only own company.
CREATE POLICY "ai_action_audit_update_company"
  ON public.ai_action_audit FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
    )
  );
