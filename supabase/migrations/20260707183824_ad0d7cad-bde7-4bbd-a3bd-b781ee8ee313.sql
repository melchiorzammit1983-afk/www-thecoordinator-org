
-- Trip display names + place ids + cached from→to ETA
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS pickup_display_name  text,
  ADD COLUMN IF NOT EXISTS dropoff_display_name text,
  ADD COLUMN IF NOT EXISTS pickup_place_id      text,
  ADD COLUMN IF NOT EXISTS dropoff_place_id     text,
  ADD COLUMN IF NOT EXISTS route_duration_sec   integer,
  ADD COLUMN IF NOT EXISTS route_distance_m     integer,
  ADD COLUMN IF NOT EXISTS route_computed_at    timestamptz;

-- Admin-configurable urgency-glow thresholds for unassigned/unaccepted trips
ALTER TABLE public.admin_portal_settings
  ADD COLUMN IF NOT EXISTS urgency_green_min  integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS urgency_orange_min integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS urgency_red_min    integer NOT NULL DEFAULT 30;

-- Seed the two new billable, admin-toggleable features
INSERT INTO public.ai_feature_costs (feature_key, label, category, points_cost, enabled, block_on_empty)
VALUES
  ('address_name_resolve', 'Address name lookup', 'data', 0.20, true, false),
  ('route_eta',            'From→To ETA',         'data', 0.30, true, false)
ON CONFLICT (feature_key) DO NOTHING;
