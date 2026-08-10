-- Milestone 26 / Stage 1: reusable company-private Portal definitions.
-- This is additive; existing portal_companies/public booking flows are unchanged.

CREATE TABLE public.portals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description text,
  portal_type text NOT NULL CHECK (portal_type IN (
    'corporate', 'hr', 'hotel', 'crew_change', 'conference', 'event', 'client', 'custom'
  )),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX portals_company_status_idx ON public.portals (company_id, status);
CREATE INDEX portals_company_created_idx ON public.portals (company_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_portals_touch_updated_at ON public.portals;
CREATE TRIGGER trg_portals_touch_updated_at
  BEFORE UPDATE ON public.portals
  FOR EACH ROW EXECUTE FUNCTION public.touch_transport_updated_at();

ALTER TABLE public.portals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.portals TO authenticated;
GRANT ALL ON public.portals TO service_role;

CREATE POLICY "Company owners manage portals"
  ON public.portals FOR ALL TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()))
  WITH CHECK (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
