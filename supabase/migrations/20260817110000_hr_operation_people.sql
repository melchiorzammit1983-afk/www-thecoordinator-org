-- HR booking people use the same Operation Workspace member model.
ALTER TABLE public.operation_group_members
  ADD COLUMN IF NOT EXISTS visit_start_date date,
  ADD COLUMN IF NOT EXISTS visit_end_date date;

ALTER TABLE public.operation_group_members
  DROP CONSTRAINT IF EXISTS operation_group_members_visit_dates_check;

ALTER TABLE public.operation_group_members
  ADD CONSTRAINT operation_group_members_visit_dates_check
  CHECK (visit_start_date IS NULL OR visit_end_date IS NULL OR visit_end_date >= visit_start_date);
