ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS group_id uuid NULL;
CREATE INDEX IF NOT EXISTS jobs_group_id_idx ON public.jobs(group_id) WHERE group_id IS NOT NULL;