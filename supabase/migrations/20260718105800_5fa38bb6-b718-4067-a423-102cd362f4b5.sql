INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty, label, category)
VALUES ('ai_coordinator_assist', 1, true, false, 'AI coordinator assistant', 'ai')
ON CONFLICT (feature_key) DO NOTHING;