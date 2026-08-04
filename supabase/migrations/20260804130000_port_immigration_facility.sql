-- Record whether immigration is handled at the port itself.
-- A false value causes Ship Arrival bookings to add the configured Valletta
-- immigration-office stop; existing ports remain conservative by default.
ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS immigration_available boolean NOT NULL DEFAULT false;
