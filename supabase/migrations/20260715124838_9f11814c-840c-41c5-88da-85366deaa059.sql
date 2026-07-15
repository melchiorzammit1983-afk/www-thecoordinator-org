ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS driver_cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_cancel_requested_by uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_cancel_reason text,
  ADD COLUMN IF NOT EXISTS driver_cancel_note text;

CREATE INDEX IF NOT EXISTS idx_jobs_driver_cancel_pending
  ON public.jobs (company_id)
  WHERE driver_cancel_requested_at IS NOT NULL;