
DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending','paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS payment_status public.payment_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS driver_hidden_at timestamptz;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS seats_available integer,
  ADD COLUMN IF NOT EXISTS availability_note text,
  ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
