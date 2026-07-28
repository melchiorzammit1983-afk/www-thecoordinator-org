CREATE TABLE public.crew_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id UUID NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  phone TEXT,
  email TEXT NOT NULL,
  nationality TEXT,
  ship_name TEXT,
  link_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  deleted_at TIMESTAMPTZ,
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'fil')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_members TO authenticated;
GRANT ALL ON public.crew_members TO service_role;
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX idx_crew_members_portal_email_active
  ON public.crew_members(portal_company_id, lower(email))
  WHERE deleted_at IS NULL;
CREATE INDEX idx_crew_members_portal ON public.crew_members(portal_company_id);
CREATE INDEX idx_crew_members_link_token ON public.crew_members(link_token);

CREATE POLICY "coordinator can manage own crew members"
  ON public.crew_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = crew_members.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portal_companies pc WHERE pc.id = crew_members.portal_company_id
    AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))));

CREATE TRIGGER trg_crew_members_updated_at
  BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.crew_itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id UUID NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  leg_number SMALLINT NOT NULL CHECK (leg_number BETWEEN 1 AND 3),
  departure_date DATE,
  arrival_date DATE,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  flight_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_itineraries TO authenticated;
GRANT ALL ON public.crew_itineraries TO service_role;
ALTER TABLE public.crew_itineraries ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crew_itineraries_crew_member ON public.crew_itineraries(crew_member_id);
CREATE POLICY "coordinator can manage own crew itineraries"
  ON public.crew_itineraries FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crew_members cm
    JOIN public.portal_companies pc ON pc.id = cm.portal_company_id
    WHERE cm.id = crew_itineraries.crew_member_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crew_members cm
    JOIN public.portal_companies pc ON pc.id = cm.portal_company_id
    WHERE cm.id = crew_itineraries.crew_member_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ));

CREATE TABLE public.crew_login_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id UUID NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.crew_login_codes TO service_role;
ALTER TABLE public.crew_login_codes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crew_login_codes_lookup ON public.crew_login_codes(crew_member_id, code);

CREATE TABLE public.crew_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id UUID NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  leg_number SMALLINT CHECK (leg_number BETWEEN 1 AND 3),
  status TEXT NOT NULL CHECK (status IN (
    'not_yet_departed', 'boarding', 'boarded', 'landed',
    'missed_connection', 'delayed', 'arrived'
  )),
  updated_by TEXT NOT NULL DEFAULT 'crew' CHECK (updated_by IN ('crew', 'coordinator', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.crew_status_log TO authenticated;
GRANT ALL ON public.crew_status_log TO service_role;
ALTER TABLE public.crew_status_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crew_status_log_crew_member ON public.crew_status_log(crew_member_id, created_at DESC);
CREATE POLICY "coordinator can read own crew status log"
  ON public.crew_status_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crew_members cm
    JOIN public.portal_companies pc ON pc.id = cm.portal_company_id
    WHERE cm.id = crew_status_log.crew_member_id
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  ));