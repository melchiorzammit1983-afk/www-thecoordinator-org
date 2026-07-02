ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS group_name text NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS group_note text NULL;