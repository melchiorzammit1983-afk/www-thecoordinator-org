
-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.connection_mode AS ENUM ('sync','provider');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.connection_status AS ENUM ('pending','active','revoked','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dispatch_status AS ENUM ('pending','accepted','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ TABLES ============
CREATE TABLE IF NOT EXISTS public.coordinator_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  partner_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  mode public.connection_mode NOT NULL,
  status public.connection_status NOT NULL DEFAULT 'active',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diff_companies CHECK (owner_company_id <> partner_company_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_connections_pair_uniq
  ON public.coordinator_connections (
    LEAST(owner_company_id, partner_company_id),
    GREATEST(owner_company_id, partner_company_id)
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coordinator_connections TO authenticated;
GRANT ALL ON public.coordinator_connections TO service_role;
ALTER TABLE public.coordinator_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.connection_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  owner_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  mode public.connection_mode NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connection_invites TO authenticated;
GRANT ALL ON public.connection_invites TO service_role;
ALTER TABLE public.connection_invites ENABLE ROW LEVEL SECURITY;

-- ============ JOBS EXTENSIONS ============
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS origin_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS executor_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatch_status public.dispatch_status,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_note text;

-- Backfill origin/executor for existing jobs
UPDATE public.jobs SET origin_company_id = company_id WHERE origin_company_id IS NULL;
UPDATE public.jobs SET executor_company_id = company_id WHERE executor_company_id IS NULL;

CREATE INDEX IF NOT EXISTS jobs_origin_company_idx ON public.jobs(origin_company_id);
CREATE INDEX IF NOT EXISTS jobs_executor_company_idx ON public.jobs(executor_company_id);
CREATE INDEX IF NOT EXISTS jobs_dispatch_status_idx ON public.jobs(dispatch_status);

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public.company_of(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.companies WHERE owner_user_id = _user_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.company_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_of(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_connection_permission(
  _viewer_company uuid, _target_company uuid, _perm text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coordinator_connections c
    WHERE c.status = 'active'
      AND (
        (c.owner_company_id = _viewer_company AND c.partner_company_id = _target_company)
        OR
        (c.partner_company_id = _viewer_company AND c.owner_company_id = _target_company)
      )
      AND (
        c.mode = 'sync' AND COALESCE((c.permissions->>_perm)::boolean, false)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_connection_permission(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_connection_permission(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_executor_of(_viewer_company uuid, _job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job_id AND j.executor_company_id = _viewer_company
  );
$$;
REVOKE ALL ON FUNCTION public.is_executor_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_executor_of(uuid, uuid) TO authenticated, service_role;

-- ============ TRIGGERS ============
DROP TRIGGER IF EXISTS trg_coordinator_connections_updated_at ON public.coordinator_connections;
CREATE TRIGGER trg_coordinator_connections_updated_at
BEFORE UPDATE ON public.coordinator_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ POLICIES: coordinator_connections ============
DROP POLICY IF EXISTS conn_select ON public.coordinator_connections;
CREATE POLICY conn_select ON public.coordinator_connections FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_company_owner(auth.uid(), owner_company_id)
    OR public.is_company_owner(auth.uid(), partner_company_id)
  );

DROP POLICY IF EXISTS conn_insert ON public.coordinator_connections;
CREATE POLICY conn_insert ON public.coordinator_connections FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_company_owner(auth.uid(), owner_company_id));

DROP POLICY IF EXISTS conn_update ON public.coordinator_connections;
CREATE POLICY conn_update ON public.coordinator_connections FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_company_owner(auth.uid(), owner_company_id)
    OR public.is_company_owner(auth.uid(), partner_company_id)
  );

DROP POLICY IF EXISTS conn_delete ON public.coordinator_connections;
CREATE POLICY conn_delete ON public.coordinator_connections FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_company_owner(auth.uid(), owner_company_id));

-- ============ POLICIES: connection_invites ============
DROP POLICY IF EXISTS invite_select ON public.connection_invites;
CREATE POLICY invite_select ON public.connection_invites FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_company_owner(auth.uid(), owner_company_id));

DROP POLICY IF EXISTS invite_insert ON public.connection_invites;
CREATE POLICY invite_insert ON public.connection_invites FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_company_owner(auth.uid(), owner_company_id));

DROP POLICY IF EXISTS invite_update ON public.connection_invites;
CREATE POLICY invite_update ON public.connection_invites FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_company_owner(auth.uid(), owner_company_id));

DROP POLICY IF EXISTS invite_delete ON public.connection_invites;
CREATE POLICY invite_delete ON public.connection_invites FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_company_owner(auth.uid(), owner_company_id));

-- ============ EXTEND JOBS RLS to allow partner access ============
-- Read existing jobs policies and add supplementary permission-based policies.
DROP POLICY IF EXISTS jobs_partner_select ON public.jobs;
CREATE POLICY jobs_partner_select ON public.jobs FOR SELECT TO authenticated
  USING (
    -- executor company (provider mode) can see the job dispatched to it
    executor_company_id = public.company_of(auth.uid())
    OR origin_company_id = public.company_of(auth.uid())
    -- or connected sync partner with view_jobs permission
    OR public.has_connection_permission(public.company_of(auth.uid()), company_id, 'view_jobs')
  );

DROP POLICY IF EXISTS jobs_partner_update ON public.jobs;
CREATE POLICY jobs_partner_update ON public.jobs FOR UPDATE TO authenticated
  USING (
    executor_company_id = public.company_of(auth.uid())
    OR public.has_connection_permission(public.company_of(auth.uid()), company_id, 'edit_jobs')
  );

-- ============ FEATURE COST ============
INSERT INTO public.feature_costs (feature_name, points_cost)
VALUES ('dispatch_partner', 1)
ON CONFLICT (feature_name) DO NOTHING;

-- ============ REALTIME ============
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_status_updates;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pax;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
