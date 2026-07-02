
-- Per-trip client link + client tracking + follow-up requests

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_link_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS parent_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'coordinator';

CREATE INDEX IF NOT EXISTS jobs_parent_job_id_idx ON public.jobs(parent_job_id);
CREATE INDEX IF NOT EXISTS jobs_client_link_token_idx ON public.jobs(client_link_token);

-- client_link_identities: which pax the client picked on their device
CREATE TABLE IF NOT EXISTS public.client_link_identities (
  token text NOT NULL,
  device_id text NOT NULL,
  pax_id uuid,
  pax_name text,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token, device_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_link_identities TO authenticated;
GRANT ALL ON public.client_link_identities TO service_role;
ALTER TABLE public.client_link_identities ENABLE ROW LEVEL SECURITY;
-- No policies — access is server-only via SECURITY DEFINER RPCs / supabaseAdmin.

-- client_locations: passenger-shared locations (live + one-shot pins)
CREATE TABLE IF NOT EXISTS public.client_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  pax_id uuid,
  pax_name text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_m double precision,
  mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('live','pin')),
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_locations_job_idx ON public.client_locations(job_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS client_locations_company_idx ON public.client_locations(company_id, captured_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_locations TO authenticated;
GRANT ALL ON public.client_locations TO service_role;
ALTER TABLE public.client_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinators read client locations in chain"
  ON public.client_locations FOR SELECT TO authenticated
  USING (public.job_in_my_chain(job_id) OR public.is_admin(auth.uid()));

-- Backfill: every existing job gets a client link token
UPDATE public.jobs
   SET client_link_token = encode(gen_random_bytes(16), 'hex')
 WHERE client_link_token IS NULL;
