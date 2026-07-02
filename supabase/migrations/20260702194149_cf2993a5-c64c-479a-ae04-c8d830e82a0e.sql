
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_confirmed_at timestamptz;

ALTER TABLE public.client_link_identities
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Enable realtime on client_link_identities & client_locations if not already
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.client_link_identities;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.client_locations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
