CREATE TABLE public.ai_training_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  original_text TEXT NOT NULL,
  ai_initial_output JSONB NOT NULL,
  human_corrected_output JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ai_training_logs TO authenticated;
GRANT ALL ON public.ai_training_logs TO service_role;

ALTER TABLE public.ai_training_logs ENABLE ROW LEVEL SECURITY;

-- Coordinators can insert their own training samples
CREATE POLICY "Users insert own training logs"
  ON public.ai_training_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Admins can read all; users can read their own
CREATE POLICY "Admins read all training logs"
  ON public.ai_training_logs
  FOR SELECT
  TO authenticated
  USING (private.is_admin(auth.uid()));

CREATE POLICY "Users read own training logs"
  ON public.ai_training_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX ai_training_logs_created_at_idx ON public.ai_training_logs (created_at DESC);
CREATE INDEX ai_training_logs_company_id_idx ON public.ai_training_logs (company_id);