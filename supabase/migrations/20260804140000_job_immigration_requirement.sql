-- Capture the coordinator's immigration requirement decision on the
-- authoritative booking row. Existing jobs remain unchanged (NULL).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS immigration_required text;

ALTER TABLE public.client_bookings
  ADD COLUMN IF NOT EXISTS immigration_required text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_immigration_required_check'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_immigration_required_check
      CHECK (immigration_required IS NULL OR immigration_required IN ('yes', 'no', 'unknown'));
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_bookings_immigration_required_check'
      AND conrelid = 'public.client_bookings'::regclass
  ) THEN
    ALTER TABLE public.client_bookings
      ADD CONSTRAINT client_bookings_immigration_required_check
      CHECK (immigration_required IS NULL OR immigration_required IN ('yes', 'no', 'unknown'));
  END IF;
END;
$$;
