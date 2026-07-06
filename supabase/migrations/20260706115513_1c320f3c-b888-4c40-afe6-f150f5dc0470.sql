
-- 1) portal_companies
CREATE TABLE public.portal_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coordinator_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'hotel' CHECK (kind IN ('hotel','agent','corporate')),
  contact_email TEXT,
  contact_phone TEXT,
  logo_url TEXT,
  brand_color TEXT DEFAULT '#0f172a',
  display_name_for_passenger TEXT,
  points_per_booking NUMERIC(10,2) NOT NULL DEFAULT 3,
  monthly_seat_points NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  link_enabled BOOLEAN NOT NULL DEFAULT true,
  link_expires_at TIMESTAMPTZ,
  magic_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  notification_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_companies TO authenticated;
GRANT ALL ON public.portal_companies TO service_role;
ALTER TABLE public.portal_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can manage own portal companies"
  ON public.portal_companies FOR ALL TO authenticated
  USING (private.company_of(auth.uid()) = coordinator_company_id OR private.is_admin(auth.uid()))
  WITH CHECK (private.company_of(auth.uid()) = coordinator_company_id OR private.is_admin(auth.uid()));
CREATE INDEX idx_portal_companies_coord ON public.portal_companies(coordinator_company_id);
CREATE INDEX idx_portal_companies_token ON public.portal_companies(magic_token);

-- 2) portal_bookings
CREATE TABLE public.portal_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id UUID NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','change_requested','cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_email TEXT,
  created_by_name TEXT,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  agreed_price NUMERIC(10,2),
  currency TEXT DEFAULT 'EUR',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_bookings TO authenticated;
GRANT ALL ON public.portal_bookings TO service_role;
ALTER TABLE public.portal_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can manage own portal bookings"
  ON public.portal_bookings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_bookings.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_bookings.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))));
CREATE INDEX idx_portal_bookings_portal_status ON public.portal_bookings(portal_company_id, status);
CREATE INDEX idx_portal_bookings_job ON public.portal_bookings(job_id);

-- 3) portal_change_requests
CREATE TABLE public.portal_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_booking_id UUID NOT NULL REFERENCES public.portal_bookings(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('edit','cancel','reschedule')),
  requested_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_change_requests TO authenticated;
GRANT ALL ON public.portal_change_requests TO service_role;
ALTER TABLE public.portal_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can manage portal change requests"
  ON public.portal_change_requests FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.portal_bookings pb
    JOIN public.portal_companies pc ON pc.id = pb.portal_company_id
    WHERE pb.id = portal_change_requests.portal_booking_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.portal_bookings pb
    JOIN public.portal_companies pc ON pc.id = pb.portal_company_id
    WHERE pb.id = portal_change_requests.portal_booking_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ));
CREATE INDEX idx_portal_change_requests_booking ON public.portal_change_requests(portal_booking_id);

-- 4) portal_threads / portal_messages
CREATE TABLE public.portal_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  portal_booking_id UUID REFERENCES public.portal_bookings(id) ON DELETE CASCADE,
  portal_company_id UUID NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('hotel_coord','hotel_pax','coord_pax')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_booking_id, scope)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_threads TO authenticated;
GRANT ALL ON public.portal_threads TO service_role;
ALTER TABLE public.portal_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can access portal threads"
  ON public.portal_threads FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_threads.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_threads.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))));
CREATE INDEX idx_portal_threads_booking ON public.portal_threads(portal_booking_id);
CREATE INDEX idx_portal_threads_job ON public.portal_threads(job_id);

CREATE TABLE public.portal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.portal_threads(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('portal','coordinator','passenger')),
  sender_label TEXT,
  body TEXT NOT NULL,
  read_by JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_messages TO authenticated;
GRANT ALL ON public.portal_messages TO service_role;
ALTER TABLE public.portal_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can access portal messages"
  ON public.portal_messages FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.portal_threads pt
    JOIN public.portal_companies pc ON pc.id = pt.portal_company_id
    WHERE pt.id = portal_messages.thread_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.portal_threads pt
    JOIN public.portal_companies pc ON pc.id = pt.portal_company_id
    WHERE pt.id = portal_messages.thread_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ));
CREATE INDEX idx_portal_messages_thread ON public.portal_messages(thread_id, created_at);

-- 5) payment threads/messages
CREATE TABLE public.portal_payment_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_booking_id UUID NOT NULL REFERENCES public.portal_bookings(id) ON DELETE CASCADE,
  portal_company_id UUID NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('hotel_coord','hotel_pax')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_booking_id, scope)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_payment_threads TO authenticated;
GRANT ALL ON public.portal_payment_threads TO service_role;
ALTER TABLE public.portal_payment_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can access portal payment threads"
  ON public.portal_payment_threads FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_payment_threads.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_payment_threads.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))));

CREATE TABLE public.portal_payment_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.portal_payment_threads(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('portal','coordinator','passenger')),
  sender_label TEXT,
  body TEXT,
  amount NUMERIC(10,2),
  currency TEXT DEFAULT 'EUR',
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message','proposal','accept','reject')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_payment_messages TO authenticated;
GRANT ALL ON public.portal_payment_messages TO service_role;
ALTER TABLE public.portal_payment_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can access portal payment messages"
  ON public.portal_payment_messages FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.portal_payment_threads pt
    JOIN public.portal_companies pc ON pc.id = pt.portal_company_id
    WHERE pt.id = portal_payment_messages.thread_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.portal_payment_threads pt
    JOIN public.portal_companies pc ON pc.id = pt.portal_company_id
    WHERE pt.id = portal_payment_messages.thread_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ));
CREATE INDEX idx_portal_payment_messages_thread ON public.portal_payment_messages(thread_id, created_at);

-- 6) pax_tracking_tokens
CREATE TABLE public.pax_tracking_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  portal_booking_id UUID REFERENCES public.portal_bookings(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  phone_last4 TEXT,
  booking_ref TEXT,
  location_share_requested_at TIMESTAMPTZ,
  location_share_granted_at TIMESTAMPTZ,
  location_share_expires_at TIMESTAMPTZ,
  show_driver_location BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pax_tracking_tokens TO authenticated;
GRANT ALL ON public.pax_tracking_tokens TO service_role;
ALTER TABLE public.pax_tracking_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can manage pax tokens for own jobs"
  ON public.pax_tracking_tokens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = pax_tracking_tokens.job_id
    AND (private.company_of(auth.uid()) IN (j.company_id, j.executor_company_id, j.origin_company_id) OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = pax_tracking_tokens.job_id
    AND (private.company_of(auth.uid()) IN (j.company_id, j.executor_company_id, j.origin_company_id) OR private.is_admin(auth.uid()))));
CREATE INDEX idx_pax_tokens_token ON public.pax_tracking_tokens(token);
CREATE INDEX idx_pax_tokens_job ON public.pax_tracking_tokens(job_id);

-- 7) portal_statements
CREATE TABLE public.portal_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id UUID NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_statements TO authenticated;
GRANT ALL ON public.portal_statements TO service_role;
ALTER TABLE public.portal_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can manage portal statements"
  ON public.portal_statements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_statements.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_statements.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))));

-- 8) portal_link_events
CREATE TABLE public.portal_link_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id UUID NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('coordinator','hotel','admin','system')),
  event TEXT NOT NULL,
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_link_events TO authenticated;
GRANT ALL ON public.portal_link_events TO service_role;
ALTER TABLE public.portal_link_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator can view own portal events"
  ON public.portal_link_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = portal_link_events.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))));

-- 9) portal_rate_limits
CREATE TABLE public.portal_rate_limits (
  token TEXT NOT NULL,
  minute_bucket BIGINT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token, minute_bucket)
);
GRANT ALL ON public.portal_rate_limits TO service_role;
ALTER TABLE public.portal_rate_limits ENABLE ROW LEVEL SECURITY;

-- 10) admin_portal_settings (singleton)
CREATE TABLE public.admin_portal_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_points_per_booking NUMERIC(10,2) NOT NULL DEFAULT 3,
  default_seat_points NUMERIC(10,2) NOT NULL DEFAULT 0,
  allow_bulk BOOLEAN NOT NULL DEFAULT true,
  require_approval_within_hours INTEGER NOT NULL DEFAULT 2,
  max_link_duration_hours INTEGER NOT NULL DEFAULT 8760,
  allow_coord_pax_chat BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_portal_settings TO authenticated;
GRANT ALL ON public.admin_portal_settings TO service_role;
ALTER TABLE public.admin_portal_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone authenticated can read portal settings"
  ON public.admin_portal_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin can update portal settings"
  ON public.admin_portal_settings FOR UPDATE TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

INSERT INTO public.admin_portal_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 11) updated_at triggers
CREATE TRIGGER trg_portal_companies_updated BEFORE UPDATE ON public.portal_companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_portal_bookings_updated BEFORE UPDATE ON public.portal_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_portal_change_requests_updated BEFORE UPDATE ON public.portal_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 12) Realtime
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_payment_messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_bookings; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_change_requests; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 13) Seed feature costs
INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty, label, category)
VALUES
  ('portal_booking', 3, true, true, 'Portal booking accept', 'portal'),
  ('portal_seat_weekly', 0, true, false, 'Portal seat weekly', 'portal')
ON CONFLICT (feature_key) DO NOTHING;
