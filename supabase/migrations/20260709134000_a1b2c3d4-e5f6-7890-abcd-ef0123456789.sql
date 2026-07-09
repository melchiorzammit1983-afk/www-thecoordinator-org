
-- GPS-verified arrival telemetry persisted on the job at the moment the
-- driver taps "Arrived at pickup" and the server-side validation passes.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS arrival_verified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS arrival_lat            double precision,
  ADD COLUMN IF NOT EXISTS arrival_lng            double precision,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m     double precision,
  ADD COLUMN IF NOT EXISTS arrival_heading        double precision,
  ADD COLUMN IF NOT EXISTS arrival_speed_mps      double precision,
  ADD COLUMN IF NOT EXISTS arrival_street_address text,
  ADD COLUMN IF NOT EXISTS arrival_distance_m     double precision;
