
-- 1) Add stable uuid id + first_seen_at to client_link_identities.
ALTER TABLE public.client_link_identities
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz;

-- Backfill first_seen_at from chosen_at where null
UPDATE public.client_link_identities
   SET first_seen_at = COALESCE(first_seen_at, chosen_at)
 WHERE first_seen_at IS NULL;

-- Unique index so the id can act as a stable foreign key target
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='client_link_identities_id_key'
  ) THEN
    CREATE UNIQUE INDEX client_link_identities_id_key ON public.client_link_identities(id);
  END IF;
END $$;

-- 2) Add pax_id to trip_messages so coordinators can queue private messages
--    to a specific passenger slot before that passenger has picked their name.
ALTER TABLE public.trip_messages
  ADD COLUMN IF NOT EXISTS pax_id uuid REFERENCES public.pax(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS trip_messages_pax_idx
  ON public.trip_messages(job_id, pax_id, created_at);
