-- Preserve Port Directory selections on token-created client bookings until
-- a coordinator accepts them into a Job.
ALTER TABLE public.client_bookings
  ADD COLUMN IF NOT EXISTS from_port_id uuid REFERENCES public.ports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS from_berth_id uuid REFERENCES public.berths(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS to_port_id uuid REFERENCES public.ports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS to_berth_id uuid REFERENCES public.berths(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS client_bookings_from_port_id_idx ON public.client_bookings (from_port_id) WHERE from_port_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_bookings_to_port_id_idx ON public.client_bookings (to_port_id) WHERE to_port_id IS NOT NULL;
