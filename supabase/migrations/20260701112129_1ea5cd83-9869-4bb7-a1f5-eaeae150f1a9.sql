
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'en_route';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'arrived';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.pax
  ADD COLUMN IF NOT EXISTS boarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS boarded_method text;
