ALTER TABLE public.pax
  ADD COLUMN IF NOT EXISTS stop_id uuid REFERENCES public.group_stops(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pax_stop_id_idx ON public.pax(stop_id) WHERE stop_id IS NOT NULL;