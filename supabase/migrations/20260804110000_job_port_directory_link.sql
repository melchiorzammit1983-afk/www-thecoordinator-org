-- Additive Port Directory references for new bookings. Historical Jobs/Trips
-- remain unchanged with NULL relationships.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS from_port_id uuid REFERENCES public.ports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS from_berth_id uuid REFERENCES public.berths(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS to_port_id uuid REFERENCES public.ports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS to_berth_id uuid REFERENCES public.berths(id) ON DELETE RESTRICT;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS from_port_id uuid REFERENCES public.ports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS from_berth_id uuid REFERENCES public.berths(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS to_port_id uuid REFERENCES public.ports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS to_berth_id uuid REFERENCES public.berths(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS jobs_from_port_id_idx ON public.jobs (from_port_id) WHERE from_port_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_to_port_id_idx ON public.jobs (to_port_id) WHERE to_port_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_from_port_id_idx ON public.trips (from_port_id) WHERE from_port_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_to_port_id_idx ON public.trips (to_port_id) WHERE to_port_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mirror_job_port_directory_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trips
     SET from_port_id = NEW.from_port_id,
         from_berth_id = NEW.from_berth_id,
         to_port_id = NEW.to_port_id,
         to_berth_id = NEW.to_berth_id,
         updated_at = now()
   WHERE legacy_job_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_port_directory_links ON public.jobs;
CREATE TRIGGER trg_jobs_port_directory_links
  AFTER INSERT OR UPDATE OF from_port_id, from_berth_id, to_port_id, to_berth_id
  ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.mirror_job_port_directory_links();

UPDATE public.trips t
   SET from_port_id = j.from_port_id,
       from_berth_id = j.from_berth_id,
       to_port_id = j.to_port_id,
       to_berth_id = j.to_berth_id,
       updated_at = now()
  FROM public.jobs j
 WHERE j.id = t.legacy_job_id
   AND (t.from_port_id IS DISTINCT FROM j.from_port_id
     OR t.from_berth_id IS DISTINCT FROM j.from_berth_id
     OR t.to_port_id IS DISTINCT FROM j.to_port_id
     OR t.to_berth_id IS DISTINCT FROM j.to_berth_id);
