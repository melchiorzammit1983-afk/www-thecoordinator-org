
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS from_flight text,
  ADD COLUMN IF NOT EXISTS to_flight text,
  ADD COLUMN IF NOT EXISTS flight_status text,
  ADD COLUMN IF NOT EXISTS flight_status_note text,
  ADD COLUMN IF NOT EXISTS flight_status_updated_at timestamptz;
