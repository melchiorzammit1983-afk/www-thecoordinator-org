-- Availability schedules (per company or per driver)
CREATE TABLE public.availability_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('company','driver')),
  owner_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  always_open boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_schedules TO authenticated;
GRANT ALL ON public.availability_schedules TO service_role;
ALTER TABLE public.availability_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company members read schedules" ON public.availability_schedules FOR SELECT TO authenticated
  USING (company_id = private.company_of(auth.uid()) OR private.is_admin(auth.uid()));
CREATE POLICY "company owners manage schedules" ON public.availability_schedules FOR ALL TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()))
  WITH CHECK (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
CREATE TRIGGER trg_availability_schedules_updated BEFORE UPDATE ON public.availability_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Recurring weekly windows
CREATE TABLE public.availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.availability_schedules(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_availability_windows_schedule ON public.availability_windows(schedule_id, weekday);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_windows TO authenticated;
GRANT ALL ON public.availability_windows TO service_role;
ALTER TABLE public.availability_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "windows follow schedule access" ON public.availability_windows FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.availability_schedules s WHERE s.id = schedule_id
    AND (s.company_id = private.company_of(auth.uid()) OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.availability_schedules s WHERE s.id = schedule_id
    AND (private.is_company_owner(auth.uid(), s.company_id) OR private.is_admin(auth.uid()))));

-- One-off exceptions (closed holidays or extra open days)
CREATE TABLE public.availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.availability_schedules(id) ON DELETE CASCADE,
  date date NOT NULL,
  is_open boolean NOT NULL DEFAULT false,
  start_time time,
  end_time time,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_availability_exceptions_schedule ON public.availability_exceptions(schedule_id, date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_exceptions TO authenticated;
GRANT ALL ON public.availability_exceptions TO service_role;
ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exceptions follow schedule access" ON public.availability_exceptions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.availability_schedules s WHERE s.id = schedule_id
    AND (s.company_id = private.company_of(auth.uid()) OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.availability_schedules s WHERE s.id = schedule_id
    AND (private.is_company_owner(auth.uid(), s.company_id) OR private.is_admin(auth.uid()))));

-- Per-company forwarding policy
CREATE TABLE public.availability_policies (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  forwarding_enabled boolean NOT NULL DEFAULT false,
  off_hours_mode text NOT NULL DEFAULT 'notify_then_forward'
    CHECK (off_hours_mode IN ('auto_forward','notify_then_forward','manual_pick')),
  notify_timeout_min integer NOT NULL DEFAULT 15 CHECK (notify_timeout_min BETWEEN 2 AND 60),
  unanswered_timeout_min integer NOT NULL DEFAULT 15 CHECK (unanswered_timeout_min BETWEEN 2 AND 60),
  max_forward_hops integer NOT NULL DEFAULT 5 CHECK (max_forward_hops BETWEEN 1 AND 20),
  preferred_partner_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_policies TO authenticated;
GRANT ALL ON public.availability_policies TO service_role;
ALTER TABLE public.availability_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company members read policy" ON public.availability_policies FOR SELECT TO authenticated
  USING (company_id = private.company_of(auth.uid()) OR private.is_admin(auth.uid()));
CREATE POLICY "company owners manage policy" ON public.availability_policies FOR ALL TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()))
  WITH CHECK (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
CREATE TRIGGER trg_availability_policies_updated BEFORE UPDATE ON public.availability_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Forwarding audit trail
CREATE TABLE public.dispatch_forward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  from_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  to_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  to_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('off_hours','no_response','manual','no_coverage','refund')),
  points_charged numeric(10,2) NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_forward_events_job ON public.dispatch_forward_events(job_id, created_at DESC);
GRANT SELECT, INSERT ON public.dispatch_forward_events TO authenticated;
GRANT ALL ON public.dispatch_forward_events TO service_role;
ALTER TABLE public.dispatch_forward_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parties or admin read forward events" ON public.dispatch_forward_events FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid())
    OR from_company_id = private.company_of(auth.uid())
    OR to_company_id = private.company_of(auth.uid()));

-- Track forward-related fields on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS forward_after timestamptz,
  ADD COLUMN IF NOT EXISTS forward_hop_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forward_tried_company_ids uuid[] NOT NULL DEFAULT '{}';

-- Register the auto-forward feature cost
INSERT INTO public.ai_feature_costs (feature_key, label, points_cost, enabled, block_on_empty)
VALUES ('trip_auto_forward', 'Auto-forward off-hours trip', 2, true, false)
ON CONFLICT (feature_key) DO NOTHING;