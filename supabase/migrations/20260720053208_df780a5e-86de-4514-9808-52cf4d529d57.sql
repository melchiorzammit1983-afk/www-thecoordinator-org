
CREATE OR REPLACE FUNCTION public.set_updated_at_dispatch_rules()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE public.dispatch_default_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  days_of_week INT[] NOT NULL DEFAULT '{}'::int[],
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('driver','partner')),
  target_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispatch_default_rules_company ON public.dispatch_default_rules(company_id, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_default_rules TO authenticated;
GRANT ALL ON public.dispatch_default_rules TO service_role;

ALTER TABLE public.dispatch_default_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view their dispatch rules"
  ON public.dispatch_default_rules FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()));

CREATE POLICY "Company owners can manage their dispatch rules"
  ON public.dispatch_default_rules FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()));

CREATE TRIGGER dispatch_default_rules_updated_at
  BEFORE UPDATE ON public.dispatch_default_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_dispatch_rules();
