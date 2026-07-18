
INSERT INTO public.ai_feature_costs (feature_key, points_cost, label, category, enabled, block_on_empty, metering_mode) VALUES
  ('assistant_qa', 1, 'AI assistant · question answered', 'ai', true, false, 'per_action'),
  ('assistant_trip_action', 2, 'AI assistant · trip created or edited', 'ai', true, false, 'per_action'),
  ('assistant_data_fix', 1, 'AI assistant · data fix applied', 'ai', true, false, 'per_action')
ON CONFLICT (feature_key) DO NOTHING;
