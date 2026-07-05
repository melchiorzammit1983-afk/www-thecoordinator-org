
-- ============================================================
-- job_wait_sessions
-- ============================================================
CREATE TABLE public.job_wait_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  company_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  source text NOT NULL DEFAULT 'manual',
  agreed_amount numeric(10,2),
  currency text NOT NULL DEFAULT 'EUR',
  driver_note text,
  notified_thresholds integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_wait_sessions_source_check CHECK (source IN ('manual','auto_stopped','auto_airport')),
  CONSTRAINT job_wait_sessions_amount_check CHECK (agreed_amount IS NULL OR (agreed_amount >= 0 AND agreed_amount <= 100000))
);

CREATE UNIQUE INDEX job_wait_sessions_one_open_per_job
  ON public.job_wait_sessions (job_id) WHERE ended_at IS NULL;
CREATE INDEX job_wait_sessions_job_id_idx ON public.job_wait_sessions (job_id);
CREATE INDEX job_wait_sessions_open_idx ON public.job_wait_sessions (started_at) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_wait_sessions TO authenticated;
GRANT ALL ON public.job_wait_sessions TO service_role;

ALTER TABLE public.job_wait_sessions ENABLE ROW LEVEL SECURITY;

-- Coordinators of the job's company (owner/executor/origin/chain) can read.
CREATE POLICY "wait_sessions_read_by_company"
  ON public.job_wait_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_wait_sessions.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR j.origin_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY(COALESCE(j.dispatch_chain_company_ids, ARRAY[]::uuid[]))
        )
    )
  );

-- Coordinators can insert/update/delete for their jobs (server fns still enforce driver ownership via token).
CREATE POLICY "wait_sessions_write_by_company"
  ON public.job_wait_sessions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_wait_sessions.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_wait_sessions.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  );

CREATE TRIGGER set_updated_at_job_wait_sessions
  BEFORE UPDATE ON public.job_wait_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- job_adjustments
-- ============================================================
CREATE TABLE public.job_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  company_id uuid,
  kind text NOT NULL,
  label text,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  wait_session_id uuid REFERENCES public.job_wait_sessions(id) ON DELETE SET NULL,
  driver_note text,
  source text NOT NULL DEFAULT 'driver',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_adjustments_kind_check CHECK (kind IN ('waiting','extra_stop','toll','other')),
  CONSTRAINT job_adjustments_amount_check CHECK (amount >= 0 AND amount <= 100000)
);

CREATE INDEX job_adjustments_job_id_idx ON public.job_adjustments (job_id);
CREATE INDEX job_adjustments_kind_idx ON public.job_adjustments (job_id, kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_adjustments TO authenticated;
GRANT ALL ON public.job_adjustments TO service_role;

ALTER TABLE public.job_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adjustments_read_by_company"
  ON public.job_adjustments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_adjustments.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR j.origin_company_id = private.company_of(auth.uid())
          OR private.company_of(auth.uid()) = ANY(COALESCE(j.dispatch_chain_company_ids, ARRAY[]::uuid[]))
        )
    )
  );

CREATE POLICY "adjustments_write_by_company"
  ON public.job_adjustments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_adjustments.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_adjustments.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  );
