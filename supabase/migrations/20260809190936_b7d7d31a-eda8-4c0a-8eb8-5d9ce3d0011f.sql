-- Milestone 25 / Stage 1: secure, company-scoped Operation Link foundation.
-- Raw bearer tokens are never stored; callers resolve a SHA-256 token hash.

CREATE TABLE public.operation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  operation_group_id uuid NOT NULL REFERENCES public.operation_groups(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  recipient_name text NOT NULL CHECK (char_length(btrim(recipient_name)) BETWEEN 1 AND 200),
  recipient_type text NOT NULL CHECK (recipient_type IN (
    'captain', 'ship_agent', 'conference_organiser', 'hotel',
    'corporate', 'event_organiser', 'other'
  )),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX operation_links_company_group_idx
  ON public.operation_links (company_id, operation_group_id);
CREATE INDEX operation_links_active_idx
  ON public.operation_links (operation_group_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.operation_links ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.operation_links TO service_role;
REVOKE ALL ON public.operation_links FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'operation_links'
      AND policyname = 'Company owners manage operation links'
  ) THEN
    CREATE POLICY "Company owners manage operation links"
      ON public.operation_links FOR ALL TO authenticated
      USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()))
      WITH CHECK (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
  END IF;
END $$;

-- Milestone 25 / Stage 4: immutable audit trail for external updates.
CREATE TABLE public.operation_link_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_link_id uuid NOT NULL REFERENCES public.operation_links(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  operation_group_id uuid NOT NULL REFERENCES public.operation_groups(id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type IN ('eta_updated', 'departure_updated', 'port_change_requested', 'operational_update_submitted')),
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operation_link_activity_group_idx ON public.operation_link_activity(operation_group_id, created_at DESC);
CREATE INDEX operation_link_activity_link_idx ON public.operation_link_activity(operation_link_id, created_at DESC);
ALTER TABLE public.operation_link_activity ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.operation_link_activity TO service_role;
REVOKE ALL ON public.operation_link_activity FROM PUBLIC, anon, authenticated;

-- Add the Stage 5 passenger audit action without changing the already-applied
-- Operation Link activity migration.
ALTER TABLE public.operation_link_activity
  DROP CONSTRAINT IF EXISTS operation_link_activity_action_type_check;

ALTER TABLE public.operation_link_activity
  ADD CONSTRAINT operation_link_activity_action_type_check
  CHECK (action_type IN (
    'eta_updated',
    'departure_updated',
    'port_change_requested',
    'passenger_onboard_updated',
    'operational_update_submitted'
  ));