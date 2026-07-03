
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS price_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS price_currency text DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS price_set_by text,
  ADD COLUMN IF NOT EXISTS price_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_actual_minutes integer,
  ADD COLUMN IF NOT EXISTS driver_reported_km numeric(10,2);

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_payment_method_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash','invoice'));

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_price_set_by_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_price_set_by_check
  CHECK (price_set_by IS NULL OR price_set_by IN ('driver','coordinator'));

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_price_amount_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_price_amount_check
  CHECK (price_amount IS NULL OR price_amount >= 0);
