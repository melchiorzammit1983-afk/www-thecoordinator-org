-- ============================================================
-- Batch A / Step 2
-- Waiting Logic — calculated vs. agreed amounts
-- ============================================================

-- Add calculated_amount to job_wait_sessions.
-- This column stores the system-computed charge (rate × chargeable minutes)
-- and is set once at session close. It is NEVER overwritten, even when a
-- coordinator proposal is accepted and agreed_amount changes.
ALTER TABLE public.job_wait_sessions
  ADD COLUMN IF NOT EXISTS calculated_amount numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_wait_sessions_calculated_amount_check'
  ) THEN
    ALTER TABLE public.job_wait_sessions
      ADD CONSTRAINT job_wait_sessions_calculated_amount_check
      CHECK (calculated_amount IS NULL OR (calculated_amount >= 0 AND calculated_amount <= 100000));
  END IF;
END $$;
