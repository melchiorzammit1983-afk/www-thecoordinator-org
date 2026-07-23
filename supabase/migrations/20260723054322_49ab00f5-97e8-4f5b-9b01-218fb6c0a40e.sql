-- Flight lookup: switch to AI-only with bundled + metered charging.
-- 1) New feature-cost rows: bundle + refresh + vessel keys.
-- 2) Job column that tracks whether the create+T-30 bundle was already paid.
-- 3) Preserve any admin-customised values from the legacy `flight_status_extra_lookup` row
--    by copying its cost into `flight_lookup_refresh`.

-- Bundle-tracking column (nullable timestamp; null = not yet charged).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flight_lookup_bundled_at timestamptz;

-- Seed new feature-cost rows (idempotent). Values chosen per spec:
--   flight_lookup_bundle  = 1.5 pts (covers creation lookup + T-30 recheck)
--   flight_lookup_refresh = 0.5 pts (each manual refresh after cache miss)
--   flight_lookup_vessel  = 0.5 pts (vessel lookups)
INSERT INTO public.ai_feature_costs
  (feature_key, points_cost, enabled, block_on_empty, label, category)
VALUES
  ('flight_lookup_bundle',  1.5, true, false,
     'Flight lookup — trip bundle (create + T-30)', 'ai'),
  ('flight_lookup_refresh', 0.5, true, false,
     'Flight lookup — manual refresh',              'ai'),
  ('flight_lookup_vessel',  0.5, true, false,
     'Flight lookup — vessel',                      'ai')
ON CONFLICT (feature_key) DO NOTHING;

-- If an admin previously customised `flight_status_extra_lookup`, copy that
-- value into the new manual-refresh key so migration is invisible to them.
UPDATE public.ai_feature_costs new
   SET points_cost = old.points_cost,
       enabled     = old.enabled,
       block_on_empty = old.block_on_empty
  FROM public.ai_feature_costs old
 WHERE new.feature_key = 'flight_lookup_refresh'
   AND old.feature_key = 'flight_status_extra_lookup'
   AND new.points_cost = 0.5; -- only if untouched since seed above

-- Copy vessel-tracking customisation too.
UPDATE public.ai_feature_costs new
   SET enabled = old.enabled,
       block_on_empty = old.block_on_empty
  FROM public.ai_feature_costs old
 WHERE new.feature_key = 'flight_lookup_vessel'
   AND old.feature_key = 'flight_vessel_tracking';