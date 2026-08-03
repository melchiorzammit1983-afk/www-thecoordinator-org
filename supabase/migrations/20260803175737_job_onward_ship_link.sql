-- Flight-linked jobs may optionally reference one immutable onward Ship.
-- Jobs remain authoritative; trips mirror the relationship for Transport Core.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS onward_ship_event_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'jobs_onward_ship_event_id_fkey'
       AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_onward_ship_event_id_fkey
      FOREIGN KEY (onward_ship_event_id)
      REFERENCES public.ship_events(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'jobs_onward_ship_requires_flight'
       AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_onward_ship_requires_flight
      CHECK (onward_ship_event_id IS NULL OR flight_schedule_record_id IS NOT NULL);
  END IF;
END;
$$;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS onward_ship_event_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'trips_onward_ship_event_id_fkey'
       AND conrelid = 'public.trips'::regclass
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_onward_ship_event_id_fkey
      FOREIGN KEY (onward_ship_event_id)
      REFERENCES public.ship_events(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS jobs_onward_ship_event_id_idx
  ON public.jobs (onward_ship_event_id)
  WHERE onward_ship_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trips_onward_ship_event_id_idx
  ON public.trips (onward_ship_event_id)
  WHERE onward_ship_event_id IS NOT NULL;

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
         onward_ship_event_id = NEW.onward_ship_event_id,
         scheduled_transport_pickup_offset_minutes = NEW.scheduled_transport_pickup_offset_minutes,
         updated_at = now()
   WHERE legacy_job_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_transport_core_z_transport_links ON public.jobs;
CREATE TRIGGER trg_jobs_transport_core_z_transport_links
  AFTER INSERT OR UPDATE OF
    flight_schedule_record_id,
    ship_event_id,
    onward_flight_schedule_record_id,
    onward_ship_event_id,
    scheduled_transport_pickup_offset_minutes
  ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.mirror_job_transport_links();

UPDATE public.trips t
   SET flight_schedule_record_id = j.flight_schedule_record_id,
       ship_event_id = j.ship_event_id,
       onward_flight_schedule_record_id = j.onward_flight_schedule_record_id,
       onward_ship_event_id = j.onward_ship_event_id,
       scheduled_transport_pickup_offset_minutes = j.scheduled_transport_pickup_offset_minutes,
       updated_at = now()
  FROM public.jobs j
 WHERE j.id = t.legacy_job_id
   AND (
     t.flight_schedule_record_id IS DISTINCT FROM j.flight_schedule_record_id
     OR t.ship_event_id IS DISTINCT FROM j.ship_event_id
     OR t.onward_flight_schedule_record_id IS DISTINCT FROM j.onward_flight_schedule_record_id
     OR t.onward_ship_event_id IS DISTINCT FROM j.onward_ship_event_id
     OR t.scheduled_transport_pickup_offset_minutes IS DISTINCT FROM j.scheduled_transport_pickup_offset_minutes
   );
