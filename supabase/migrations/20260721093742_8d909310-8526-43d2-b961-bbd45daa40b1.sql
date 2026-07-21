
-- Portals (open booking links)
CREATE TABLE public.public_booking_portals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordinator_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX public_booking_portals_company_idx ON public.public_booking_portals(coordinator_company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_booking_portals TO authenticated;
GRANT ALL ON public.public_booking_portals TO service_role;
ALTER TABLE public.public_booking_portals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage own public portals" ON public.public_booking_portals
  FOR ALL TO authenticated
  USING (
    coordinator_company_id IN (
      SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
      UNION
      SELECT company_id FROM public.drivers WHERE linked_user_id = auth.uid() AND company_id IS NOT NULL
    )
  )
  WITH CHECK (
    coordinator_company_id IN (
      SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
      UNION
      SELECT company_id FROM public.drivers WHERE linked_user_id = auth.uid() AND company_id IS NOT NULL
    )
  );

-- Requests submitted via those links
CREATE TABLE public.public_booking_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  portal_id UUID NOT NULL REFERENCES public.public_booking_portals(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','cancelled')),
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decided_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX public_booking_requests_portal_idx ON public.public_booking_requests(portal_id, created_at DESC);
CREATE INDEX public_booking_requests_visitor_idx ON public.public_booking_requests(portal_id, visitor_id);
CREATE INDEX public_booking_requests_status_idx ON public.public_booking_requests(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_booking_requests TO authenticated;
GRANT ALL ON public.public_booking_requests TO service_role;
ALTER TABLE public.public_booking_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage own public booking requests" ON public.public_booking_requests
  FOR ALL TO authenticated
  USING (
    portal_id IN (
      SELECT id FROM public.public_booking_portals
      WHERE coordinator_company_id IN (
        SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
        UNION
        SELECT company_id FROM public.drivers WHERE linked_user_id = auth.uid() AND company_id IS NOT NULL
      )
    )
  )
  WITH CHECK (
    portal_id IN (
      SELECT id FROM public.public_booking_portals
      WHERE coordinator_company_id IN (
        SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
        UNION
        SELECT company_id FROM public.drivers WHERE linked_user_id = auth.uid() AND company_id IS NOT NULL
      )
    )
  );

-- Messages between visitor and coordinator
CREATE TABLE public.public_booking_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  portal_id UUID NOT NULL REFERENCES public.public_booking_portals(id) ON DELETE CASCADE,
  request_id UUID REFERENCES public.public_booking_requests(id) ON DELETE SET NULL,
  visitor_id TEXT NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('visitor','coordinator')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX public_booking_messages_portal_idx ON public.public_booking_messages(portal_id, visitor_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_booking_messages TO authenticated;
GRANT ALL ON public.public_booking_messages TO service_role;
ALTER TABLE public.public_booking_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage own public booking messages" ON public.public_booking_messages
  FOR ALL TO authenticated
  USING (
    portal_id IN (
      SELECT id FROM public.public_booking_portals
      WHERE coordinator_company_id IN (
        SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
        UNION
        SELECT company_id FROM public.drivers WHERE linked_user_id = auth.uid() AND company_id IS NOT NULL
      )
    )
  )
  WITH CHECK (
    portal_id IN (
      SELECT id FROM public.public_booking_portals
      WHERE coordinator_company_id IN (
        SELECT id FROM public.companies WHERE owner_user_id = auth.uid()
        UNION
        SELECT company_id FROM public.drivers WHERE linked_user_id = auth.uid() AND company_id IS NOT NULL
      )
    )
  );

-- updated_at triggers (reusing existing function if present)
CREATE OR REPLACE FUNCTION public.public_booking_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_public_booking_portals_updated
  BEFORE UPDATE ON public.public_booking_portals
  FOR EACH ROW EXECUTE FUNCTION public.public_booking_touch_updated_at();

CREATE TRIGGER trg_public_booking_requests_updated
  BEFORE UPDATE ON public.public_booking_requests
  FOR EACH ROW EXECUTE FUNCTION public.public_booking_touch_updated_at();
