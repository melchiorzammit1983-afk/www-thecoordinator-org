-- Unify trip-entry field sets: a general-purpose notes column on jobs (so
-- HR/hotel portal notes survive approval instead of vanishing, and every
-- other entry surface can record a note), plus the flight/vessel and
-- passenger-count fields the client's own direct booking link was missing.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.jobs.notes IS
  'General-purpose coordinator/guest note, distinct from the purpose-specific driver_note/dispatch_note/group_note/promo_note columns.';

ALTER TABLE public.client_bookings
  ADD COLUMN IF NOT EXISTS from_flight text,
  ADD COLUMN IF NOT EXISTS pax_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.client_bookings.from_flight IS
  'Flight/vessel code or name the client entered on their own direct booking link.';
COMMENT ON COLUMN public.client_bookings.pax_count IS
  'Passenger count the client entered on their own direct booking link.';
COMMENT ON COLUMN public.client_bookings.notes IS
  'Free-text note the client entered on their own direct booking link.';
