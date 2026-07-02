
CREATE TABLE public.company_feature_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feature text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, feature)
);

GRANT SELECT ON public.company_feature_entitlements TO authenticated;
GRANT ALL ON public.company_feature_entitlements TO service_role;

ALTER TABLE public.company_feature_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins full access to entitlements"
  ON public.company_feature_entitlements FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "company owner reads own entitlements"
  ON public.company_feature_entitlements FOR SELECT
  TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id));

CREATE TRIGGER trg_company_feature_entitlements_updated_at
  BEFORE UPDATE ON public.company_feature_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.has_feature(_company_id uuid, _feature text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT enabled AND (expires_at IS NULL OR expires_at > now())
      FROM public.company_feature_entitlements
      WHERE company_id = _company_id AND feature = _feature
      LIMIT 1
    ),
    true
  );
$$;

REVOKE ALL ON FUNCTION public.has_feature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_feature(uuid, text) TO authenticated, service_role;
