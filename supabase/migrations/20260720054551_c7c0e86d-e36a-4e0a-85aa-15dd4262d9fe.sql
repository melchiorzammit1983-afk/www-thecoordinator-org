INSERT INTO public.ai_feature_costs (feature_key, label, points_cost, enabled, block_on_empty)
VALUES ('assistant_data_check', 'AI assistant · data check', 1.00, true, false)
ON CONFLICT (feature_key) DO NOTHING;