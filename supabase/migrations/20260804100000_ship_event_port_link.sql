-- Link new Ship Events to the company-private Port Directory.
-- Existing Ship Events remain valid with NULL relationships.
ALTER TABLE public.ship_events
  ADD COLUMN IF NOT EXISTS port_id uuid REFERENCES public.ports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS berth_id uuid REFERENCES public.berths(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ship_events_port_idx ON public.ship_events (port_id);
CREATE INDEX IF NOT EXISTS ship_events_berth_idx ON public.ship_events (berth_id);
