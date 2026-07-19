CREATE TABLE public.client_notes (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_key text NOT NULL,
  client_display text NOT NULL,
  note text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, client_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_notes TO authenticated;
GRANT ALL ON public.client_notes TO service_role;

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members read client notes"
  ON public.client_notes FOR SELECT TO authenticated
  USING (company_id = public.my_company_id(auth.uid()));

CREATE POLICY "Company members write client notes"
  ON public.client_notes FOR ALL TO authenticated
  USING (company_id = public.my_company_id(auth.uid()))
  WITH CHECK (company_id = public.my_company_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.client_notes_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_client_notes_updated_at
  BEFORE UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.client_notes_touch_updated_at();