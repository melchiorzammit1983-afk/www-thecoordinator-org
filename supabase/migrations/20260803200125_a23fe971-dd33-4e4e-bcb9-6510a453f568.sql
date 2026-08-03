ALTER TABLE public.ship_events ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS ship_events_archived_at_idx ON public.ship_events (archived_at);