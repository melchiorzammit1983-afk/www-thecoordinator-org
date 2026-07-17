
ALTER TABLE public.job_wait_sessions
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS chargeable_from timestamptz;

-- Backfill existing rows so chargeable_from mirrors started_at (previous behaviour).
UPDATE public.job_wait_sessions
   SET chargeable_from = started_at
 WHERE chargeable_from IS NULL;

UPDATE public.job_wait_sessions
   SET arrived_at = started_at
 WHERE arrived_at IS NULL;
