CREATE TABLE IF NOT EXISTS public.user_feature_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, feature_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_feature_preferences TO authenticated;
GRANT ALL ON public.user_feature_preferences TO service_role;

ALTER TABLE public.user_feature_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read own company feature prefs"
  ON public.user_feature_preferences FOR SELECT TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));

CREATE POLICY "Owners insert own company feature prefs"
  ON public.user_feature_preferences FOR INSERT TO authenticated
  WITH CHECK (private.is_company_owner(auth.uid(), company_id));

CREATE POLICY "Owners update own company feature prefs"
  ON public.user_feature_preferences FOR UPDATE TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id))
  WITH CHECK (private.is_company_owner(auth.uid(), company_id));

CREATE POLICY "Owners delete own company feature prefs"
  ON public.user_feature_preferences FOR DELETE TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id));

CREATE INDEX IF NOT EXISTS user_feature_preferences_company_idx
  ON public.user_feature_preferences (company_id);