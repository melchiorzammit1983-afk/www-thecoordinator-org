
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS leave_by_at timestamptz,
  ADD COLUMN IF NOT EXISTS traffic_delay_minutes integer,
  ADD COLUMN IF NOT EXISTS traffic_severity text CHECK (traffic_severity IN ('none','light','moderate','heavy')),
  ADD COLUMN IF NOT EXISTS traffic_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS flight_delay_minutes integer,
  ADD COLUMN IF NOT EXISTS pickup_shift_reason text;

CREATE INDEX IF NOT EXISTS idx_jobs_pickup_upcoming
  ON public.jobs (pickup_at)
  WHERE status IN ('pending','active','en_route','in_progress');

CREATE TABLE IF NOT EXISTS public.job_route_cache (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  origin_lat double precision,
  origin_lng double precision,
  dest_lat double precision,
  dest_lng double precision,
  distance_m integer,
  duration_s integer,
  duration_in_traffic_s integer,
  traffic_delay_s integer GENERATED ALWAYS AS (
    GREATEST(COALESCE(duration_in_traffic_s,0) - COALESCE(duration_s,0), 0)
  ) STORED,
  severity text CHECK (severity IN ('none','light','moderate','heavy')),
  leave_by_at timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now(),
  next_refresh_at timestamptz,
  provider text DEFAULT 'google_routes',
  raw jsonb
);

GRANT SELECT ON public.job_route_cache TO authenticated;
GRANT ALL ON public.job_route_cache TO service_role;

ALTER TABLE public.job_route_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_route_cache_read_by_involved_companies"
  ON public.job_route_cache FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_route_cache.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY (j.dispatch_chain_company_ids)
          OR private.is_admin(auth.uid())
        )
    )
  );

CREATE INDEX IF NOT EXISTS idx_route_cache_refresh
  ON public.job_route_cache (next_refresh_at)
  WHERE next_refresh_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.flight_status_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  flight_iata text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('from','to')),
  scheduled_at timestamptz,
  estimated_at timestamptz,
  actual_at timestamptz,
  status text,
  terminal text,
  gate text,
  baggage_belt text,
  delay_minutes integer,
  raw jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.flight_status_snapshots TO authenticated;
GRANT ALL ON public.flight_status_snapshots TO service_role;

ALTER TABLE public.flight_status_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flight_snapshots_read_by_involved_companies"
  ON public.flight_status_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = flight_status_snapshots.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY (j.dispatch_chain_company_ids)
          OR private.is_admin(auth.uid())
        )
    )
  );

CREATE INDEX IF NOT EXISTS idx_flight_snapshots_job_recent
  ON public.flight_status_snapshots (job_id, captured_at DESC);
