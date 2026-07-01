ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flight_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS flight_estimated_at timestamptz;