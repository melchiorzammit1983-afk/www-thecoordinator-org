-- ============================================================
-- Batch A / Step 1
-- Phase 2 Waiting System + Phase 3 Passenger Boarding
-- Database migrations only
-- ============================================================

-- ------------------------------------------------------------
-- 1) Company waiting policy configuration
-- ------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS free_wait_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS waiting_rate_per_minute numeric(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'companies_free_wait_minutes_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_free_wait_minutes_check
      CHECK (free_wait_minutes >= 0 AND free_wait_minutes <= 120);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'companies_waiting_rate_per_minute_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_waiting_rate_per_minute_check
      CHECK (waiting_rate_per_minute >= 0 AND waiting_rate_per_minute <= 100000);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) Wait session metadata for automatic waiting flow
-- ------------------------------------------------------------
ALTER TABLE public.job_wait_sessions
  ADD COLUMN IF NOT EXISTS auto_started boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_ends_at timestamptz;

-- ------------------------------------------------------------
-- 3) Coordinator wait adjustment proposals (driver must approve)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_wait_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.job_wait_sessions(id) ON DELETE CASCADE,
  company_id uuid,
  proposed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_amount numeric(10,2) NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  driver_response_note text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_wait_proposals_status_check CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT job_wait_proposals_amount_check CHECK (proposed_amount >= 0 AND proposed_amount <= 100000)
);

CREATE INDEX IF NOT EXISTS job_wait_proposals_job_id_idx
  ON public.job_wait_proposals (job_id);
CREATE INDEX IF NOT EXISTS job_wait_proposals_session_id_idx
  ON public.job_wait_proposals (session_id);
CREATE INDEX IF NOT EXISTS job_wait_proposals_open_by_job_idx
  ON public.job_wait_proposals (job_id, created_at DESC)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS job_wait_proposals_one_open_per_session
  ON public.job_wait_proposals (session_id)
  WHERE status = 'pending' AND session_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_wait_proposals TO authenticated;
GRANT ALL ON public.job_wait_proposals TO service_role;

ALTER TABLE public.job_wait_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wait_proposals_read_by_company"
  ON public.job_wait_proposals FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_wait_proposals.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR j.origin_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY(COALESCE(j.dispatch_chain_company_ids, ARRAY[]::uuid[]))
        )
    )
  );

CREATE POLICY "wait_proposals_write_by_company"
  ON public.job_wait_proposals FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_wait_proposals.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_wait_proposals.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  );

DROP TRIGGER IF EXISTS set_updated_at_job_wait_proposals ON public.job_wait_proposals;
CREATE TRIGGER set_updated_at_job_wait_proposals
  BEFORE UPDATE ON public.job_wait_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 4) Passenger boarding system schema
-- ------------------------------------------------------------
ALTER TYPE public.pax_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.pax
  ADD COLUMN IF NOT EXISTS noshow_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE TABLE IF NOT EXISTS public.job_boarding_approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  company_id uuid,
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  override_at timestamptz,
  coordinator_note text,
  driver_note text,
  pax_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_boarding_approvals_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'overridden'))
);

CREATE INDEX IF NOT EXISTS job_boarding_approvals_job_id_idx
  ON public.job_boarding_approvals (job_id);
CREATE INDEX IF NOT EXISTS job_boarding_approvals_driver_id_idx
  ON public.job_boarding_approvals (driver_id);
CREATE INDEX IF NOT EXISTS job_boarding_approvals_pending_job_idx
  ON public.job_boarding_approvals (job_id, requested_at DESC)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS job_boarding_approvals_one_open_per_job
  ON public.job_boarding_approvals (job_id)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_boarding_approvals TO authenticated;
GRANT ALL ON public.job_boarding_approvals TO service_role;

ALTER TABLE public.job_boarding_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boarding_approvals_read_by_company"
  ON public.job_boarding_approvals FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_boarding_approvals.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR j.origin_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY(COALESCE(j.dispatch_chain_company_ids, ARRAY[]::uuid[]))
        )
    )
  );

CREATE POLICY "boarding_approvals_write_by_company"
  ON public.job_boarding_approvals FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_boarding_approvals.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_boarding_approvals.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  );

DROP TRIGGER IF EXISTS set_updated_at_job_boarding_approvals ON public.job_boarding_approvals;
CREATE TRIGGER set_updated_at_job_boarding_approvals
  BEFORE UPDATE ON public.job_boarding_approvals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
