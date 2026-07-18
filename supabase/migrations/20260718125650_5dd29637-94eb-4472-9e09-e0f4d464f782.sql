
CREATE TABLE public.assistant_glossary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, term)
);

CREATE INDEX assistant_glossary_company_idx ON public.assistant_glossary(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_glossary TO authenticated;
GRANT ALL ON public.assistant_glossary TO service_role;

ALTER TABLE public.assistant_glossary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members manage their glossary"
  ON public.assistant_glossary FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = assistant_glossary.company_id
        AND c.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = assistant_glossary.company_id
        AND c.owner_user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.set_assistant_glossary_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_assistant_glossary_updated_at
  BEFORE UPDATE ON public.assistant_glossary
  FOR EACH ROW EXECUTE FUNCTION public.set_assistant_glossary_updated_at();
