-- ============================================================
-- M2 · Automated driver assignment
-- ============================================================

CREATE TABLE public.job_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  event_type text NOT NULL, -- 'auto_assigned' | 'no_driver_available' | 'skipped_disabled' | 'unassigned_by_rule'
  reason text,
  score numeric,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jae_company_created ON public.job_assignment_events(company_id, created_at DESC);
CREATE INDEX idx_jae_job ON public.job_assignment_events(job_id);

GRANT SELECT ON public.job_assignment_events TO authenticated;
GRANT ALL ON public.job_assignment_events TO service_role;

ALTER TABLE public.job_assignment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coord read own assignment events"
  ON public.job_assignment_events FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_emails ae
               JOIN auth.users u ON lower(u.email) = lower(ae.email)
               WHERE u.id = auth.uid())
  );

-- ============================================================
-- M4 · AI Configuration (automation toggles per company)
-- ============================================================

CREATE TABLE public.ai_configuration (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  auto_assign_enabled boolean NOT NULL DEFAULT false,
  auto_extract_bulk boolean NOT NULL DEFAULT true,
  auto_reply_drafts boolean NOT NULL DEFAULT true,
  ai_command_enabled boolean NOT NULL DEFAULT true,
  voice_to_trip_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_configuration TO authenticated;
GRANT ALL ON public.ai_configuration TO service_role;

ALTER TABLE public.ai_configuration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coord manage own ai config"
  ON public.ai_configuration FOR ALL TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_emails ae
               JOIN auth.users u ON lower(u.email) = lower(ae.email)
               WHERE u.id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_emails ae
               JOIN auth.users u ON lower(u.email) = lower(ae.email)
               WHERE u.id = auth.uid())
  );

CREATE TRIGGER trg_ai_config_updated
  BEFORE UPDATE ON public.ai_configuration
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- M4 · Company AI Rules (custom coordinator rules)
-- ============================================================

CREATE TABLE public.company_ai_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  rule_text text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_rules_company ON public.company_ai_rules(company_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_ai_rules TO authenticated;
GRANT ALL ON public.company_ai_rules TO service_role;

ALTER TABLE public.company_ai_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coord manage own ai rules"
  ON public.company_ai_rules FOR ALL TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_emails ae
               JOIN auth.users u ON lower(u.email) = lower(ae.email)
               WHERE u.id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_emails ae
               JOIN auth.users u ON lower(u.email) = lower(ae.email)
               WHERE u.id = auth.uid())
  );

CREATE TRIGGER trg_ai_rules_updated
  BEFORE UPDATE ON public.company_ai_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- M4 · AI Command Log
-- ============================================================

CREATE TABLE public.ai_command_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id uuid,
  mode text NOT NULL DEFAULT 'read', -- 'read' | 'execute'
  prompt text NOT NULL,
  response text,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ok', -- 'ok' | 'error' | 'awaiting_confirm' | 'cancelled'
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_cmd_company_created ON public.ai_command_log(company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.ai_command_log TO authenticated;
GRANT ALL ON public.ai_command_log TO service_role;

ALTER TABLE public.ai_command_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coord view own ai command log"
  ON public.ai_command_log FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.admin_emails ae
               JOIN auth.users u ON lower(u.email) = lower(ae.email)
               WHERE u.id = auth.uid())
  );

-- ============================================================
-- Feature costs for new AI capabilities
-- ============================================================

INSERT INTO public.ai_feature_costs (feature_key, points_cost, label) VALUES
  ('ai_auto_assign',      1, 'AI auto-assign driver'),
  ('ai_command_read',     2, 'AI command bar (read)'),
  ('ai_command_execute',  3, 'AI command bar (execute)'),
  ('ai_control_center',   0, 'AI Control Center (free)')
ON CONFLICT (feature_key) DO NOTHING;

-- ============================================================
-- M2 · auto_assign_job RPC
-- Picks the free driver with the earliest last_seen and same company.
-- Lazy — only touches free drivers, respects ai_configuration toggle.
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_assign_job(_job_id uuid)
RETURNS TABLE(driver_id uuid, reason text, score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job record;
  _cfg record;
  _pick uuid;
  _score numeric;
  _reason text;
BEGIN
  SELECT id, company_id, executor_company_id, driver_id, pickup_at, date, time, status
    INTO _job FROM public.jobs WHERE id = _job_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF _job.driver_id IS NOT NULL THEN
    RETURN QUERY SELECT _job.driver_id, 'already_assigned'::text, 0::numeric;
    RETURN;
  END IF;

  SELECT * INTO _cfg FROM public.ai_configuration
    WHERE company_id = COALESCE(_job.executor_company_id, _job.company_id);
  IF _cfg.auto_assign_enabled IS NOT TRUE THEN
    INSERT INTO public.job_assignment_events(job_id, company_id, event_type, reason)
      VALUES (_job.id, COALESCE(_job.executor_company_id, _job.company_id), 'skipped_disabled', 'auto_assign disabled');
    RETURN;
  END IF;

  -- Pick a driver from the executor company who is not already handling a
  -- job with an overlapping pickup window (±90 min).
  SELECT d.id INTO _pick
  FROM public.drivers d
  WHERE d.company_id = COALESCE(_job.executor_company_id, _job.company_id)
    AND d.status IS DISTINCT FROM 'inactive'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j2
      WHERE j2.driver_id = d.id
        AND j2.id <> _job.id
        AND j2.pickup_at IS NOT NULL
        AND _job.pickup_at IS NOT NULL
        AND abs(extract(epoch FROM (j2.pickup_at - _job.pickup_at))) < 5400
    )
  ORDER BY (
    SELECT COALESCE(max(dl.recorded_at), 'epoch'::timestamptz)
    FROM public.driver_locations dl WHERE dl.driver_id = d.id
  ) DESC NULLS LAST
  LIMIT 1;

  IF _pick IS NULL THEN
    INSERT INTO public.job_assignment_events(job_id, company_id, event_type, reason)
      VALUES (_job.id, COALESCE(_job.executor_company_id, _job.company_id), 'no_driver_available', 'no free driver in window');
    RETURN;
  END IF;

  UPDATE public.jobs SET driver_id = _pick WHERE id = _job.id;

  _score := 1;
  _reason := 'earliest-idle free driver in ±90m window';

  INSERT INTO public.job_assignment_events(job_id, company_id, driver_id, event_type, reason, score)
    VALUES (_job.id, COALESCE(_job.executor_company_id, _job.company_id), _pick, 'auto_assigned', _reason, _score);

  RETURN QUERY SELECT _pick, _reason, _score;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_assign_job(uuid) TO authenticated, service_role;