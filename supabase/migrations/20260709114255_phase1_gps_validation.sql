-- Phase 1 GPS Validation — Step 1: database migration only.
-- No application code is changed in this migration.
--
-- Adds:
--   companies.arrival_radius_m    — per-company configurable arrival radius (metres)
--   jobs.arrival_lat              — GPS latitude at arrival
--   jobs.arrival_lng              — GPS longitude at arrival
--   jobs.arrival_accuracy_m       — GPS accuracy in metres at arrival
--   jobs.arrival_heading          — driver heading in degrees (0–360) at arrival
--   jobs.arrival_speed_mps        — driver speed in metres/second at arrival
--   jobs.arrival_address          — reverse-geocoded street address at arrival
--   jobs.arrival_distance_m       — distance (metres) from pickup at time of arrival
--   jobs.arrival_validated        — true = inside radius, false = outside, null = not validated
--   jobs.arrival_captured_at      — device timestamp when GPS fix was captured
--
-- All new columns are NULL-able; no existing rows are modified.
-- Safe to apply on a live database without downtime.

-- ============================================================
-- 1.  Company-level arrival radius setting
-- ============================================================
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS arrival_radius_m integer NULL;

COMMENT ON COLUMN public.companies.arrival_radius_m IS
  'Arrival geofence radius in metres. NULL means use the application default (e.g. 150 m).';

-- ============================================================
-- 2.  Arrival GPS telemetry on jobs
-- ============================================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS arrival_lat         double precision NULL,
  ADD COLUMN IF NOT EXISTS arrival_lng         double precision NULL,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m  double precision NULL,
  ADD COLUMN IF NOT EXISTS arrival_heading     double precision NULL,
  ADD COLUMN IF NOT EXISTS arrival_speed_mps   double precision NULL,
  ADD COLUMN IF NOT EXISTS arrival_address     text             NULL,
  ADD COLUMN IF NOT EXISTS arrival_distance_m  double precision NULL,
  ADD COLUMN IF NOT EXISTS arrival_validated   boolean          NULL,
  ADD COLUMN IF NOT EXISTS arrival_captured_at timestamptz      NULL;

COMMENT ON COLUMN public.jobs.arrival_lat         IS 'WGS-84 latitude captured on the driver device when status changed to arrived.';
COMMENT ON COLUMN public.jobs.arrival_lng         IS 'WGS-84 longitude captured on the driver device when status changed to arrived.';
COMMENT ON COLUMN public.jobs.arrival_accuracy_m  IS 'GPS horizontal-accuracy radius in metres reported by the device at arrival.';
COMMENT ON COLUMN public.jobs.arrival_heading     IS 'Driver heading in degrees clockwise from north (0–360) at arrival.';
COMMENT ON COLUMN public.jobs.arrival_speed_mps   IS 'Driver speed in metres/second reported by the device at arrival.';
COMMENT ON COLUMN public.jobs.arrival_address     IS 'Reverse-geocoded street address at the arrival GPS position.';
COMMENT ON COLUMN public.jobs.arrival_distance_m  IS 'Computed distance in metres from the job pickup location to the arrival GPS position.';
COMMENT ON COLUMN public.jobs.arrival_validated   IS 'TRUE = driver was within the configured arrival radius; FALSE = outside radius; NULL = GPS validation not yet run.';
COMMENT ON COLUMN public.jobs.arrival_captured_at IS 'Timestamp (UTC) when the GPS fix was captured on the driver device, not when it was written to the database.';

-- ============================================================
-- 3.  Indexes
-- ============================================================

-- Audit queries: find all arrivals filtered by validation result and date range.
CREATE INDEX IF NOT EXISTS jobs_arrival_validated_captured_idx
  ON public.jobs (arrival_validated, arrival_captured_at)
  WHERE arrival_captured_at IS NOT NULL;

-- Distance-reporting queries: identify arrivals that were far from the pickup.
CREATE INDEX IF NOT EXISTS jobs_arrival_distance_idx
  ON public.jobs (arrival_distance_m)
  WHERE arrival_distance_m IS NOT NULL;
