-- Milestone 24 Stage 1: immutable coordinator-to-driver trip change alerts.
CREATE TABLE public.driver_trip_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by_driver_id uuid REFERENCES public.drivers(id) ON DELETE RESTRICT
);

CREATE INDEX driver_trip_updates_driver_idx ON public.driver_trip_updates(driver_id, created_at DESC);
CREATE INDEX driver_trip_updates_job_idx ON public.driver_trip_updates(job_id, created_at DESC);
CREATE UNIQUE INDEX driver_trip_updates_one_active_idx
  ON public.driver_trip_updates(job_id, driver_id)
  WHERE acknowledged_at IS NULL;

ALTER TABLE public.driver_trip_updates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.driver_trip_updates TO service_role;
REVOKE ALL ON public.driver_trip_updates FROM PUBLIC, anon, authenticated;