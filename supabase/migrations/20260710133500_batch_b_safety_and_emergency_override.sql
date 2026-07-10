-- ============================================================
-- Batch B
-- Phase 4 Driver Safety Mode + Phase 5 Emergency Override
-- ============================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS safety_mode_threshold_kmh integer NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'companies_safety_mode_threshold_kmh_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_safety_mode_threshold_kmh_check
      CHECK (safety_mode_threshold_kmh >= 1 AND safety_mode_threshold_kmh <= 200);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.job_emergency_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text NOT NULL,
  reason_note text,
  speed_mps double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_emergency_overrides_to_status_check
    CHECK (to_status IN ('arrived', 'in_progress', 'en_route', 'completed')),
  CONSTRAINT job_emergency_overrides_reason_check
    CHECK (reason IN (
      'gps_issue',
      'wrong_pickup_pin',
      'passenger_different_pickup',
      'auto_status_failed',
      'breakdown',
      'safety_concern',
      'other'
    )),
  CONSTRAINT job_emergency_overrides_reason_note_len_check
    CHECK (reason_note IS NULL OR char_length(reason_note) <= 500)
);

CREATE INDEX IF NOT EXISTS job_emergency_overrides_job_idx
  ON public.job_emergency_overrides (job_id);

CREATE INDEX IF NOT EXISTS job_emergency_overrides_driver_idx
  ON public.job_emergency_overrides (driver_id);

CREATE INDEX IF NOT EXISTS job_emergency_overrides_time_idx
  ON public.job_emergency_overrides (created_at DESC);

GRANT SELECT ON public.job_emergency_overrides TO authenticated;
GRANT ALL ON public.job_emergency_overrides TO service_role;

ALTER TABLE public.job_emergency_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emergency_overrides_read_by_company"
  ON public.job_emergency_overrides FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_emergency_overrides.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR j.origin_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY(COALESCE(j.dispatch_chain_company_ids, ARRAY[]::uuid[]))
        )
    )
  );
