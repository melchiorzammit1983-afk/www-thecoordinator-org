
CREATE TABLE IF NOT EXISTS public.driver_vehicles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plate TEXT,
  seats INTEGER NOT NULL DEFAULT 4,
  default_price_eur NUMERIC(10,2),
  per_km_eur NUMERIC(10,2),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_vehicles_driver_idx ON public.driver_vehicles(driver_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_vehicles TO authenticated;
GRANT ALL ON public.driver_vehicles TO service_role;
ALTER TABLE public.driver_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles readable in same company"
  ON public.driver_vehicles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id));
CREATE POLICY "vehicles manageable by company members"
  ON public.driver_vehicles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id));
