ALTER TABLE public.ai_command_log
  ADD COLUMN IF NOT EXISTS requires_confirmation boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_actions jsonb,
  ADD COLUMN IF NOT EXISTS affected_count integer NOT NULL DEFAULT 0;

INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty)
VALUES
  ('ai_agent_message', 1, true, true),
  ('ai_agent_dispatch', 1, true, true)
ON CONFLICT (feature_key) DO NOTHING;
