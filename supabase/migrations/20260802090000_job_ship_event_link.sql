-- Ship Operations v1.5: jobs keep the immutable relationship; ship details stay on ship_events.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS ship_event_id uuid
    REFERENCES public.ship_events(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS jobs_ship_event_id_idx
  ON public.jobs (ship_event_id)
  WHERE ship_event_id IS NOT NULL;
