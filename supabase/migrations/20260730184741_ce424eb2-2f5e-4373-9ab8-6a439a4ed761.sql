ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS email text;