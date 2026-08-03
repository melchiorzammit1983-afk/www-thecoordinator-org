ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS from_location_type text,
  ADD COLUMN IF NOT EXISTS to_location_type text,
  ADD COLUMN IF NOT EXISTS onward_ship_event_id uuid REFERENCES public.ship_events(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_from_location_type_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_from_location_type_check
      CHECK (from_location_type IS NULL OR from_location_type IN ('airport','port','local'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_to_location_type_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_to_location_type_check
      CHECK (to_location_type IS NULL OR to_location_type IN ('airport','port','local'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_onward_ship_event_id ON public.jobs(onward_ship_event_id);