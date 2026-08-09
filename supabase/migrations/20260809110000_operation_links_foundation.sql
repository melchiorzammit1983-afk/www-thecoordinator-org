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
