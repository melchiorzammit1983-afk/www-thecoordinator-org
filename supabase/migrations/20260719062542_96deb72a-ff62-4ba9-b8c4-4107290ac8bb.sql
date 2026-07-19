
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flight_t30_checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flight_t30_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_jobs_flight_t30_sweep
  ON public.jobs (pickup_at)
  WHERE flight_t30_checked = false
    AND (from_flight IS NOT NULL OR to_flight IS NOT NULL)
    AND status NOT IN ('completed','cancelled');

INSERT INTO public.ai_feature_costs (feature_key, label, points_cost, category, enabled, block_on_empty, metering_mode, sort_order)
VALUES ('flight_status_extra_lookup', 'Flight status extra lookup', 0.30, 'ai', true, false, 'per_action', 0)
ON CONFLICT (feature_key) DO NOTHING;
