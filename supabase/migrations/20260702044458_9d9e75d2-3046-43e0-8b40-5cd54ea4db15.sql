
CREATE TABLE public.driver_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_locations_job_idx ON public.driver_locations(job_id, captured_at DESC);
CREATE INDEX driver_locations_driver_idx ON public.driver_locations(driver_id, captured_at DESC);

GRANT SELECT ON public.driver_locations TO authenticated;
GRANT ALL ON public.driver_locations TO service_role;

ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

-- Coordinators from any company in the dispatch chain can read
CREATE POLICY "chain_can_read_driver_locations" ON public.driver_locations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = driver_locations.job_id
        AND public.company_of(auth.uid()) IS NOT NULL
        AND (
          j.company_id = public.company_of(auth.uid())
          OR j.executor_company_id = public.company_of(auth.uid())
          OR j.origin_company_id = public.company_of(auth.uid())
          OR public.company_of(auth.uid()) = ANY(COALESCE(j.dispatch_chain_company_ids, ARRAY[]::uuid[]))
        )
    )
  );

-- No client-side INSERT policy: writes flow through service-role server function
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
