
-- 1) Route optimizations table
CREATE TABLE public.group_route_optimizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  company_id uuid NOT NULL,
  original_order uuid[] NOT NULL,
  suggested_order uuid[] NOT NULL,
  approved_order uuid[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  model text,
  reasoning text,
  distance_meters_original integer,
  distance_meters_suggested integer,
  duration_seconds_original integer,
  duration_seconds_suggested integer,
  requested_by_user_id uuid REFERENCES auth.users(id),
  decided_by_user_id uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.group_route_optimizations TO authenticated;
GRANT ALL ON public.group_route_optimizations TO service_role;

ALTER TABLE public.group_route_optimizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gro_select_company_or_admin"
  ON public.group_route_optimizations FOR SELECT
  TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR company_id = private.company_of(auth.uid())
  );

CREATE POLICY "gro_write_company_or_admin"
  ON public.group_route_optimizations FOR INSERT
  TO authenticated
  WITH CHECK (
    private.is_admin(auth.uid())
    OR company_id = private.company_of(auth.uid())
  );

CREATE POLICY "gro_update_company_or_admin"
  ON public.group_route_optimizations FOR UPDATE
  TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR company_id = private.company_of(auth.uid())
  )
  WITH CHECK (
    private.is_admin(auth.uid())
    OR company_id = private.company_of(auth.uid())
  );

CREATE UNIQUE INDEX gro_one_pending_per_group
  ON public.group_route_optimizations(group_id)
  WHERE status = 'pending';

CREATE INDEX idx_gro_company_created
  ON public.group_route_optimizations(company_id, created_at DESC);

CREATE INDEX idx_gro_group_created
  ON public.group_route_optimizations(group_id, created_at DESC);

CREATE TRIGGER trg_gro_updated_at
  BEFORE UPDATE ON public.group_route_optimizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Companies: auto next job toggle
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS auto_next_job_enabled boolean NOT NULL DEFAULT true;

-- 3) Point billing seed
INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty)
VALUES ('route_optimization', 3, true, true)
ON CONFLICT (feature_key) DO NOTHING;

-- 4) Production readiness index
CREATE INDEX IF NOT EXISTS idx_jobs_driver_pickup
  ON public.jobs(driver_id, pickup_at)
  WHERE driver_id IS NOT NULL;
