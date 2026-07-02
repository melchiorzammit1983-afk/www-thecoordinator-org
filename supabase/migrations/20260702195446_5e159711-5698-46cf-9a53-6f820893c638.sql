
-- Chat threading
ALTER TABLE public.trip_messages
  ADD COLUMN IF NOT EXISTS thread_kind text NOT NULL DEFAULT 'group' CHECK (thread_kind IN ('group','private')),
  ADD COLUMN IF NOT EXISTS client_identity_id uuid,
  ADD COLUMN IF NOT EXISTS is_sos boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS trip_messages_thread_idx
  ON public.trip_messages (job_id, thread_kind, created_at);

-- Flight enrichment
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flight_terminal text,
  ADD COLUMN IF NOT EXISTS flight_gate text,
  ADD COLUMN IF NOT EXISTS flight_baggage_belt text;

-- Push subscriptions
CREATE TABLE IF NOT EXISTS public.client_push_subs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  device_id text NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token, device_id, endpoint)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_push_subs TO authenticated;
GRANT ALL ON public.client_push_subs TO service_role;
ALTER TABLE public.client_push_subs ENABLE ROW LEVEL SECURITY;
-- Access only via service role from server functions
CREATE POLICY "no_direct_access" ON public.client_push_subs FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- SOS events
CREATE TABLE IF NOT EXISTS public.client_sos_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  token text NOT NULL,
  device_id text,
  pax_name text,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  note text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_sos_events TO authenticated;
GRANT ALL ON public.client_sos_events TO service_role;
ALTER TABLE public.client_sos_events ENABLE ROW LEVEL SECURITY;
-- Coordinators of the job's company/chain can read; writes go through server functions with service role
CREATE POLICY "sos_read_by_chain" ON public.client_sos_events FOR SELECT TO authenticated
  USING (public.job_in_my_chain(job_id));
CREATE POLICY "sos_ack_by_chain" ON public.client_sos_events FOR UPDATE TO authenticated
  USING (public.job_in_my_chain(job_id))
  WITH CHECK (public.job_in_my_chain(job_id));

CREATE INDEX IF NOT EXISTS client_sos_events_job_idx ON public.client_sos_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_sos_events_open_idx ON public.client_sos_events (acknowledged_at) WHERE acknowledged_at IS NULL;

-- Realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_sos_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_messages;
