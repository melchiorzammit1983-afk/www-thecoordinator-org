-- A trip keeps a stable reference to the exact immutable schedule record chosen
-- by the coordinator. Jobs remain authoritative; trips mirror that value.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flight_schedule_record_id uuid
    REFERENCES public.flight_schedule_records(id) ON DELETE RESTRICT;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS flight_schedule_record_id uuid
    REFERENCES public.flight_schedule_records(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS jobs_flight_schedule_record_id_idx
  ON public.jobs (flight_schedule_record_id)
  WHERE flight_schedule_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trips_flight_schedule_record_id_idx
  ON public.trips (flight_schedule_record_id)
  WHERE flight_schedule_record_id IS NOT NULL;

-- This runs after the existing transport-core mirror trigger (the z prefix is
-- deliberate: PostgreSQL executes same-timing triggers alphabetically).
CREATE OR REPLACE FUNCTION public.mirror_job_flight_schedule_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trips
     SET flight_schedule_record_id = NEW.flight_schedule_record_id,
         updated_at = now()
   WHERE legacy_job_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_transport_core_z_flight_schedule_link ON public.jobs;
CREATE TRIGGER trg_jobs_transport_core_z_flight_schedule_link
  AFTER INSERT OR UPDATE OF flight_schedule_record_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.mirror_job_flight_schedule_link();
