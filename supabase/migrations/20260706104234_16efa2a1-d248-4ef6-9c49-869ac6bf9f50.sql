INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty)
VALUES ('auto_shift_early_flight', 1, true, true)
ON CONFLICT (feature_key) DO NOTHING;