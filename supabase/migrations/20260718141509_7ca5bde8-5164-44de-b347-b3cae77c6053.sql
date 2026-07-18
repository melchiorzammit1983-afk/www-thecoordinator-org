
CREATE TABLE public.watchtower_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity SMALLINT NOT NULL DEFAULT 3,
  title TEXT NOT NULL,
  body TEXT,
  suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (company_id, dedupe_key)
);
CREATE INDEX watchtower_alerts_company_created_idx
  ON public.watchtower_alerts (company_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchtower_alerts TO authenticated;
GRANT ALL ON public.watchtower_alerts TO service_role;
ALTER TABLE public.watchtower_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members read own watchtower alerts"
  ON public.watchtower_alerts FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()));
CREATE POLICY "Company members update own watchtower alerts"
  ON public.watchtower_alerts FOR UPDATE TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid()));

CREATE TABLE public.watchtower_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  interval_sec INTEGER NOT NULL DEFAULT 300,
  severity_min SMALLINT NOT NULL DEFAULT 2,
  kinds TEXT[] NOT NULL DEFAULT ARRAY['flight','execution','conflict','data']::TEXT[],
  daily_scan_cap INTEGER NOT NULL DEFAULT 200,
  scans_today INTEGER NOT NULL DEFAULT 0,
  scans_reset_on DATE NOT NULL DEFAULT CURRENT_DATE,
  last_scan_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchtower_settings TO authenticated;
GRANT ALL ON public.watchtower_settings TO service_role;
ALTER TABLE public.watchtower_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own watchtower settings"
  ON public.watchtower_settings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

INSERT INTO public.ai_feature_costs (feature_key, points_cost, label, category, enabled)
VALUES ('ai_watchtower_scan', 1, 'AI Watchtower scan', 'ai', true)
ON CONFLICT (feature_key) DO NOTHING;
