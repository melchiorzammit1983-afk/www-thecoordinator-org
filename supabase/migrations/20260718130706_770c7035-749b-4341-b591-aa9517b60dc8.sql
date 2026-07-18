
-- Silent learning layer for the AI dispatch assistant.
-- assistant_action_log records every proposed AI action and its outcome.
-- assistant_learned_preferences stores a short, LLM-summarized set of soft
-- preference notes per company, overwritten by a daily summarization job.

CREATE TABLE public.assistant_action_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_kind TEXT NOT NULL CHECK (action_kind IN ('draft','batch','search_update','data_fix','partner_suggest')),
  outcome TEXT NOT NULL CHECK (outcome IN ('confirmed','edited_then_confirmed','cancelled','skipped')),
  proposed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_message TEXT
);
GRANT SELECT, INSERT ON public.assistant_action_log TO authenticated;
GRANT ALL ON public.assistant_action_log TO service_role;
ALTER TABLE public.assistant_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can read their assistant action log"
  ON public.assistant_action_log FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()));

CREATE POLICY "Company members can insert their own action log entries"
  ON public.assistant_action_log FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
    AND actor_user_id = auth.uid()
  );

CREATE INDEX assistant_action_log_company_created_idx
  ON public.assistant_action_log (company_id, created_at DESC);

CREATE TABLE public.assistant_learned_preferences (
  company_id UUID NOT NULL PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  sample_size INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.assistant_learned_preferences TO authenticated;
GRANT ALL ON public.assistant_learned_preferences TO service_role;
ALTER TABLE public.assistant_learned_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can read their learned preferences"
  ON public.assistant_learned_preferences FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()));
