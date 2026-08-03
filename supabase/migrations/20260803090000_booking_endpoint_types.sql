-- Deterministic booking-domain endpoint classifications for new journeys.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS from_location_type text,
  ADD COLUMN IF NOT EXISTS to_location_type text,
  ADD CONSTRAINT jobs_from_location_type_check CHECK (from_location_type IS NULL OR from_location_type IN ('airport', 'port', 'local')),
  ADD CONSTRAINT jobs_to_location_type_check CHECK (to_location_type IS NULL OR to_location_type IN ('airport', 'port', 'local'));

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS from_location_type text,
  ADD COLUMN IF NOT EXISTS to_location_type text,
  ADD CONSTRAINT trips_from_location_type_check CHECK (from_location_type IS NULL OR from_location_type IN ('airport', 'port', 'local')),
  ADD CONSTRAINT trips_to_location_type_check CHECK (to_location_type IS NULL OR to_location_type IN ('airport', 'port', 'local'));
