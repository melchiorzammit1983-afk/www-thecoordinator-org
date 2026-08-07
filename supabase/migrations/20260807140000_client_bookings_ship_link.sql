-- Lets a client booking (submitted via the public /c/$token link) link to a
-- company's ship_events, matching what jobs/portal_bookings already support,
-- so a client-linked ship shows up on the coordinator's trip card exactly
-- like one they linked themselves.
ALTER TABLE public.client_bookings
  ADD COLUMN ship_event_id UUID REFERENCES public.ship_events(id) ON DELETE SET NULL,
  ADD COLUMN tracking_kind TEXT;
