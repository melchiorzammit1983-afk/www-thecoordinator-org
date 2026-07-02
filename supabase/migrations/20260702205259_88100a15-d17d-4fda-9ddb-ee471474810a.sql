ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS coordinator_last_viewed_at timestamptz;

ALTER TABLE public.client_booking_modifications
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

ALTER TABLE public.client_sos_events
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

ALTER TABLE public.client_bookings
  ADD COLUMN IF NOT EXISTS coordinator_acked_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_via text;

CREATE INDEX IF NOT EXISTS trip_messages_unread_by_coord_idx
  ON public.trip_messages (job_id)
  WHERE read_by_coordinator_at IS NULL;

CREATE INDEX IF NOT EXISTS jobs_last_viewed_idx
  ON public.jobs (id, coordinator_last_viewed_at);

CREATE INDEX IF NOT EXISTS client_bookings_parent_job_idx
  ON public.client_bookings (parent_job_id);