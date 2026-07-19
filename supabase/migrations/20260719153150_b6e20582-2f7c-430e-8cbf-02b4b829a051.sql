
CREATE TABLE public.ai_raw_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  company_id uuid,
  actor_user_id uuid,
  feature_key text NOT NULL,
  surface text,
  model text,
  aig_run_id text,
  aig_log_id text,
  finish_reason text,
  parse_ok boolean NOT NULL DEFAULT false,
  parse_error text,
  raw_content text,
  content_length int,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX ai_raw_responses_created_at_idx ON public.ai_raw_responses (created_at DESC);
CREATE INDEX ai_raw_responses_feature_idx ON public.ai_raw_responses (feature_key, created_at DESC);
CREATE INDEX ai_raw_responses_company_idx ON public.ai_raw_responses (company_id, created_at DESC);
CREATE INDEX ai_raw_responses_parse_ok_idx ON public.ai_raw_responses (parse_ok, created_at DESC);
CREATE INDEX ai_raw_responses_aig_log_idx ON public.ai_raw_responses (aig_log_id);
CREATE INDEX ai_raw_responses_aig_run_idx ON public.ai_raw_responses (aig_run_id);

GRANT SELECT ON public.ai_raw_responses TO authenticated;
GRANT ALL ON public.ai_raw_responses TO service_role;

ALTER TABLE public.ai_raw_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view raw AI responses"
  ON public.ai_raw_responses FOR SELECT
  TO authenticated
  USING (private.is_admin(auth.uid()));
