ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS grouped_count integer,
  ADD COLUMN IF NOT EXISTS grouped_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_grouped_at_idx ON public.jobs(grouped_at) WHERE grouped_at IS NOT NULL;