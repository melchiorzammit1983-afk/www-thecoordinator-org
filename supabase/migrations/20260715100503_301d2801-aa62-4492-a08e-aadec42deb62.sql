
-- Batch B (Safety Mode + Emergency Override) — base + delta

-- 1. Company Safety Mode settings
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS safety_mode_threshold_kmh integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS safety_mode_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS safety_mode_allow_override boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_safety_mode_threshold_kmh_check') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_safety_mode_threshold_kmh_check
      CHECK (safety_mode_threshold_kmh >= 1 AND safety_mode_threshold_kmh <= 200);
  END IF;
END $$;

-- 2. Emergency override audit table
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
  photo_url text,
  gps_accuracy_m numeric,
  street_address text,
  vehicle_label text,
  pax_count integer,
  approval_status text NOT NULL DEFAULT 'auto_approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_emergency_overrides_to_status_check
    CHECK (to_status IN ('arrived', 'in_progress', 'en_route', 'completed')),
  CONSTRAINT job_emergency_overrides_reason_check
    CHECK (reason IN (
      'gps_issue',
      'wrong_pickup_pin',
      'passenger_different_pickup',
      'auto_status_failed',
      'road_closure',
      'breakdown',
      'passenger_already_on_board',
      'safety_concern',
      'other'
    )),
  CONSTRAINT job_emergency_overrides_reason_note_len_check
    CHECK (reason_note IS NULL OR char_length(reason_note) <= 500),
  CONSTRAINT job_emergency_overrides_approval_status_check
    CHECK (approval_status IN ('auto_approved','pending_review','reviewed'))
);

-- If the table pre-existed without the newer columns, add them now.
ALTER TABLE public.job_emergency_overrides
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS street_address text,
  ADD COLUMN IF NOT EXISTS vehicle_label text,
  ADD COLUMN IF NOT EXISTS pax_count integer,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'auto_approved';

-- Refresh the reason check to include the new reasons if the table pre-existed
ALTER TABLE public.job_emergency_overrides
  DROP CONSTRAINT IF EXISTS job_emergency_overrides_reason_check;
ALTER TABLE public.job_emergency_overrides
  ADD CONSTRAINT job_emergency_overrides_reason_check
  CHECK (reason IN (
    'gps_issue','wrong_pickup_pin','passenger_different_pickup','auto_status_failed',
    'road_closure','breakdown','passenger_already_on_board','safety_concern','other'
  ));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_emergency_overrides_approval_status_check') THEN
    ALTER TABLE public.job_emergency_overrides
      ADD CONSTRAINT job_emergency_overrides_approval_status_check
      CHECK (approval_status IN ('auto_approved','pending_review','reviewed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS job_emergency_overrides_job_idx    ON public.job_emergency_overrides (job_id);
CREATE INDEX IF NOT EXISTS job_emergency_overrides_driver_idx ON public.job_emergency_overrides (driver_id);
CREATE INDEX IF NOT EXISTS job_emergency_overrides_time_idx   ON public.job_emergency_overrides (created_at DESC);

GRANT SELECT ON public.job_emergency_overrides TO authenticated;
GRANT ALL ON public.job_emergency_overrides TO service_role;

ALTER TABLE public.job_emergency_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emergency_overrides_read_by_company" ON public.job_emergency_overrides;
CREATE POLICY "emergency_overrides_read_by_company"
  ON public.job_emergency_overrides FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_emergency_overrides.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR j.origin_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY(COALESCE(j.dispatch_chain_company_ids, ARRAY[]::uuid[]))
        )
    )
  );

-- 3. Trip flags surfaced to coordinators after safety-concern / breakdown overrides
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS safety_flag_at timestamptz,
  ADD COLUMN IF NOT EXISTS safety_flag_note text,
  ADD COLUMN IF NOT EXISTS breakdown_flag_at timestamptz,
  ADD COLUMN IF NOT EXISTS breakdown_flag_note text,
  ADD COLUMN IF NOT EXISTS breakdown_pax_count integer;
