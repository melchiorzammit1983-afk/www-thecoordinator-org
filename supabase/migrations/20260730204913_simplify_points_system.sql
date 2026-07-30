-- Simplify the points/billing system: turn on the core "trip lands in
-- dispatch" and "trip dispatched to a collaborator" charges (the code has
-- always called spend_points for these — they were just switched off), wire
-- up the bulk-import batch fee, and retire feature keys that were never
-- actually invoked by any code path (verified against points_ledger: zero
-- historical rows reference any of them, so nothing is lost).
--
-- flight/vessel tracking stays exactly as it already worked (charged via
-- flight_lookup_refresh / flight_lookup_vessel from applyLiveStatusToJobBg
-- whenever a trip has a flight or vessel code) — no change needed there.

UPDATE public.ai_feature_costs SET enabled = true
  WHERE feature_key = 'trip_created';

UPDATE public.ai_feature_costs SET enabled = true, points_cost = 1.00
  WHERE feature_key = 'trip_dispatched';

UPDATE public.ai_feature_costs SET points_cost = 0.50
  WHERE feature_key = 'bulkupload';

-- Dead entries: defined here but never referenced by any spend_points call
-- site in the app. dispatch_partner and trip_dispatched both described
-- "dispatch to a collaborator" — trip_dispatched is the one the code
-- actually uses, so dispatch_partner is a pure duplicate.
DELETE FROM public.ai_feature_costs
  WHERE feature_key IN ('dispatch_partner', 'magic_link_client', 'magic_link_driver', 'flight_lookup_bundle');
