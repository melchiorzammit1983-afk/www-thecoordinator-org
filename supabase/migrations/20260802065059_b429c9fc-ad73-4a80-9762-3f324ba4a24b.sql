ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_departure_pickup_offset_minutes integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS default_arrival_pickup_offset_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.companies ALTER COLUMN default_departure_pickup_offset_minutes SET DEFAULT 180;
ALTER TABLE public.companies ALTER COLUMN default_arrival_pickup_offset_minutes SET DEFAULT 0;

UPDATE public.companies SET default_departure_pickup_offset_minutes = 180 WHERE default_departure_pickup_offset_minutes IS NULL OR default_departure_pickup_offset_minutes < 0 OR default_departure_pickup_offset_minutes > 1440;
UPDATE public.companies SET default_arrival_pickup_offset_minutes = 0 WHERE default_arrival_pickup_offset_minutes IS NULL OR default_arrival_pickup_offset_minutes < 0 OR default_arrival_pickup_offset_minutes > 1440;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_default_departure_pickup_offset_minutes_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_default_departure_pickup_offset_minutes_check CHECK (default_departure_pickup_offset_minutes BETWEEN 0 AND 1440);
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_default_arrival_pickup_offset_minutes_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_default_arrival_pickup_offset_minutes_check CHECK (default_arrival_pickup_offset_minutes BETWEEN 0 AND 1440);

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS scheduled_transport_pickup_offset_minutes integer;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_scheduled_transport_pickup_offset_minutes_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_scheduled_transport_pickup_offset_minutes_check CHECK (scheduled_transport_pickup_offset_minutes IS NULL OR scheduled_transport_pickup_offset_minutes BETWEEN 0 AND 1440);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trips') THEN
    EXECUTE 'ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS scheduled_transport_pickup_offset_minutes integer';
    EXECUTE 'ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_scheduled_transport_pickup_offset_minutes_check';
    EXECUTE 'ALTER TABLE public.trips ADD CONSTRAINT trips_scheduled_transport_pickup_offset_minutes_check CHECK (scheduled_transport_pickup_offset_minutes IS NULL OR scheduled_transport_pickup_offset_minutes BETWEEN 0 AND 1440)';
  END IF;
END $$;