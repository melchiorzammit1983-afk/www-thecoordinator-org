-- Re-apply Phase 1 arrival telemetry columns (kept for audit history only).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS arrival_verified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS arrival_lat            double precision,
  ADD COLUMN IF NOT EXISTS arrival_lng            double precision,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m     double precision,
  ADD COLUMN IF NOT EXISTS arrival_heading        double precision,
  ADD COLUMN IF NOT EXISTS arrival_speed_mps      double precision,
  ADD COLUMN IF NOT EXISTS arrival_street_address text,
  ADD COLUMN IF NOT EXISTS arrival_distance_m     double precision;

-- Force PostgREST to reload its schema cache so the columns are usable immediately.
NOTIFY pgrst, 'reload schema';