
ALTER TABLE public.ai_configuration
  ADD COLUMN IF NOT EXISTS auto_coordinate_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.ai_feature_costs
  ADD COLUMN IF NOT EXISTS metering_mode text NOT NULL DEFAULT 'per_action';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_costs_metering_mode_check'
  ) THEN
    ALTER TABLE public.ai_feature_costs
      ADD CONSTRAINT ai_feature_costs_metering_mode_check
      CHECK (metering_mode IN ('per_action','per_run','per_trip'));
  END IF;
END $$;

UPDATE public.ai_feature_costs           SET feature_key='ai_auto_coordinate' WHERE feature_key='ai_group_suggestions';
UPDATE public.company_feature_entitlements SET feature='ai_auto_coordinate'   WHERE feature='ai_group_suggestions';
UPDATE public.company_feature_price_overrides SET feature_key='ai_auto_coordinate' WHERE feature_key='ai_group_suggestions';

INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty, metering_mode)
VALUES ('ai_auto_coordinate', 2, true, true, 'per_action')
ON CONFLICT (feature_key) DO NOTHING;
