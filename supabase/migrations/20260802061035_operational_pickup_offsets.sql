-- Company defaults are used only when a coordinator first links a scheduled
-- transport. The selected value is stored on the job for historical integrity.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_departure_pickup_offset_minutes integer NOT NULL DEFAULT 180
    CHECK (default_departure_pickup_offset_minutes BETWEEN 0 AND 1440),
  ADD COLUMN IF NOT EXISTS default_arrival_pickup_offset_minutes integer NOT NULL DEFAULT 0
    CHECK (default_arrival_pickup_offset_minutes BETWEEN 0 AND 1440);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS scheduled_transport_pickup_offset_minutes integer
    CHECK (scheduled_transport_pickup_offset_minutes BETWEEN 0 AND 1440);

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS scheduled_transport_pickup_offset_minutes integer
    CHECK (scheduled_transport_pickup_offset_minutes BETWEEN 0 AND 1440);

-- Jobs are authoritative; linked transport metadata mirrors into the core trip.
CREATE OR REPLACE FUNCTION public.mirror_job_flight_schedule_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trips
     SET flight_schedule_record_id = NEW.flight_schedule_record_id,
         scheduled_transport_pickup_offset_minutes = NEW.scheduled_transport_pickup_offset_minutes,
         updated_at = now()
   WHERE legacy_job_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_transport_core_z_flight_schedule_link ON public.jobs;
CREATE TRIGGER trg_jobs_transport_core_z_flight_schedule_link
  AFTER INSERT OR UPDATE OF flight_schedule_record_id, scheduled_transport_pickup_offset_minutes ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.mirror_job_flight_schedule_link();
