-- Crew Management System — Phase 2: crew login + status tracking

ALTER TABLE public.crew_members
  ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'fil'));

-- One-time login codes, emailed to the crew member's registered address.
-- Service-role only: crew never talk to Supabase directly, only through the
-- /api/crew-portal/* routes (which use the admin client), so no anon/authenticated
-- policies are needed here — mirrors password_reset_requests / hr_signup_codes.
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

-- Status updates crew post as they travel (per itinerary leg).
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
