
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS price_per_km NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_per_hour NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_driver_pay_per_km NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_driver_pay_per_hour NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_driver_wait_share_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS default_driver_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS pay_per_km NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS pay_per_hour NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS wait_share_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(5,2);

CREATE TABLE IF NOT EXISTS public.service_areas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  currency TEXT,
  base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_per_km NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_per_hour NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimum_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  free_wait_minutes INTEGER,
  waiting_rate_per_minute NUMERIC(10,2),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_areas TO authenticated;
GRANT ALL ON public.service_areas TO service_role;

ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company owner manages service areas"
  ON public.service_areas FOR ALL
  TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_service_areas_updated_at ON public.service_areas;
CREATE TRIGGER trg_service_areas_updated_at
  BEFORE UPDATE ON public.service_areas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_service_areas_company ON public.service_areas(company_id, sort_order);
