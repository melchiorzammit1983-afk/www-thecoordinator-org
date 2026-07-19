
CREATE TABLE public.ai_model_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model text UNIQUE NOT NULL,
  input_usd_per_1m numeric(12,4) NOT NULL DEFAULT 0,
  output_usd_per_1m numeric(12,4) NOT NULL DEFAULT 0,
  credits_per_usd numeric(12,4) NOT NULL DEFAULT 100,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_model_rates TO authenticated;
GRANT ALL ON public.ai_model_rates TO service_role;
ALTER TABLE public.ai_model_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ai_model_rates" ON public.ai_model_rates FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "Authenticated read ai_model_rates" ON public.ai_model_rates FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_ai_model_rates_updated BEFORE UPDATE ON public.ai_model_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ai_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  actor_user_id uuid,
  feature_key text NOT NULL,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  real_cost_usd_cents numeric(14,6) NOT NULL DEFAULT 0,
  real_cost_credits numeric(14,6) NOT NULL DEFAULT 0,
  points_charged numeric(10,2) NOT NULL DEFAULT 0,
  job_id uuid,
  aig_log_id text,
  aig_run_id text,
  surface text,
  duration_ms integer,
  status text NOT NULL DEFAULT 'ok'
);
GRANT SELECT ON public.ai_cost_events TO authenticated;
GRANT ALL ON public.ai_cost_events TO service_role;
ALTER TABLE public.ai_cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read all ai_cost_events" ON public.ai_cost_events FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()));
CREATE POLICY "Company owners read own ai_cost_events" ON public.ai_cost_events FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id = ai_cost_events.company_id AND c.owner_user_id = auth.uid()
  ));
CREATE INDEX idx_ai_cost_events_created ON public.ai_cost_events (created_at DESC);
CREATE INDEX idx_ai_cost_events_company ON public.ai_cost_events (company_id, created_at DESC);
CREATE INDEX idx_ai_cost_events_feature ON public.ai_cost_events (feature_key, created_at DESC);
CREATE INDEX idx_ai_cost_events_actor ON public.ai_cost_events (actor_user_id, created_at DESC);

INSERT INTO public.ai_model_rates (model, input_usd_per_1m, output_usd_per_1m, credits_per_usd, notes) VALUES
  ('google/gemini-2.5-flash',      0.30,  2.50, 100, 'Verify against current Lovable pricing'),
  ('google/gemini-2.5-flash-lite', 0.10,  0.40, 100, 'Verify against current Lovable pricing'),
  ('google/gemini-2.5-pro',        1.25, 10.00, 100, 'Verify against current Lovable pricing'),
  ('google/gemini-1.5-flash',      0.075, 0.30, 100, 'Verify against current Lovable pricing'),
  ('google/gemini-1.5-flash-lite', 0.05,  0.20, 100, 'Verify against current Lovable pricing'),
  ('openai/gpt-5-mini',            0.15,  0.60, 100, 'Verify against current Lovable pricing'),
  ('openai/gpt-5-nano',            0.05,  0.20, 100, 'Verify against current Lovable pricing')
ON CONFLICT (model) DO NOTHING;
