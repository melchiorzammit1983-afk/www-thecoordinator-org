-- A Ship-linked job may optionally reference one separately selected onward
-- departure. Jobs remain authoritative and trips mirror all transport links.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS minimum_connection_buffer_minutes integer NOT NULL DEFAULT 60
    CHECK (minimum_connection_buffer_minutes BETWEEN 0 AND 1440);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS onward_flight_schedule_record_id uuid
    REFERENCES public.flight_schedule_records(id) ON DELETE RESTRICT;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_onward_flight_requires_ship,
  ADD CONSTRAINT jobs_onward_flight_requires_ship
    CHECK (onward_flight_schedule_record_id IS NULL OR ship_event_id IS NOT NULL);

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS ship_event_id uuid
    REFERENCES public.ship_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS onward_flight_schedule_record_id uuid
    REFERENCES public.flight_schedule_records(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS jobs_onward_flight_schedule_record_id_idx
  ON public.jobs (onward_flight_schedule_record_id)
  WHERE onward_flight_schedule_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_onward_flight_schedule_record_id_idx
  ON public.trips (onward_flight_schedule_record_id)
  WHERE onward_flight_schedule_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_ship_event_id_idx
  ON public.trips (ship_event_id)
  WHERE ship_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mirror_job_transport_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trips
     SET flight_schedule_record_id = NEW.flight_schedule_record_id,
         ship_event_id = NEW.ship_event_id,
         onward_flight_schedule_record_id = NEW.onward_flight_schedule_record_id,
         scheduled_transport_pickup_offset_minutes = NEW.scheduled_transport_pickup_offset_minutes,
         updated_at = now()
   WHERE legacy_job_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_transport_core_z_flight_schedule_link ON public.jobs;
DROP TRIGGER IF EXISTS trg_jobs_transport_core_z_transport_links ON public.jobs;
CREATE TRIGGER trg_jobs_transport_core_z_transport_links
  AFTER INSERT OR UPDATE OF flight_schedule_record_id, ship_event_id, onward_flight_schedule_record_id, scheduled_transport_pickup_offset_minutes ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.mirror_job_transport_links();

UPDATE public.trips t
   SET flight_schedule_record_id = j.flight_schedule_record_id,
       ship_event_id = j.ship_event_id,
       onward_flight_schedule_record_id = j.onward_flight_schedule_record_id,
       scheduled_transport_pickup_offset_minutes = j.scheduled_transport_pickup_offset_minutes,
       updated_at = now()
  FROM public.jobs j
 WHERE j.id = t.legacy_job_id
   AND (t.flight_schedule_record_id IS DISTINCT FROM j.flight_schedule_record_id
     OR t.ship_event_id IS DISTINCT FROM j.ship_event_id
     OR t.onward_flight_schedule_record_id IS DISTINCT FROM j.onward_flight_schedule_record_id
     OR t.scheduled_transport_pickup_offset_minutes IS DISTINCT FROM j.scheduled_transport_pickup_offset_minutes);
