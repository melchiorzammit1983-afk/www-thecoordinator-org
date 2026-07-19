
CREATE TABLE IF NOT EXISTS public.ai_char_overage_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  free_char_threshold integer NOT NULL DEFAULT 1000 CHECK (free_char_threshold >= 0),
  price_per_char numeric(10,6) NOT NULL DEFAULT 0.01 CHECK (price_per_char >= 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_char_overage_settings_company_uniq
  ON public.ai_char_overage_settings (company_id)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_char_overage_settings_global_uniq
  ON public.ai_char_overage_settings ((company_id IS NULL))
  WHERE company_id IS NULL;

GRANT SELECT ON public.ai_char_overage_settings TO authenticated;
GRANT ALL ON public.ai_char_overage_settings TO service_role;

ALTER TABLE public.ai_char_overage_settings ENABLE ROW LEVEL SECURITY;

-- Company owners can read their own row or the global default.
CREATE POLICY "read own or global overage settings"
  ON public.ai_char_overage_settings FOR SELECT
  TO authenticated
  USING (
    company_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = ai_char_overage_settings.company_id
        AND c.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid()
    )
  );

-- Writes are handled server-side via service_role (admin.functions / overage.functions).
-- No INSERT/UPDATE/DELETE policies for authenticated → clients cannot bypass server checks.

-- Seed the global default row if missing.
INSERT INTO public.ai_char_overage_settings (company_id, free_char_threshold, price_per_char, enabled)
SELECT NULL, 1000, 0.01, true
WHERE NOT EXISTS (SELECT 1 FROM public.ai_char_overage_settings WHERE company_id IS NULL);

-- Register the billable feature. block_on_empty=true so insufficient balance raises
-- and the caller can gracefully truncate the input.
INSERT INTO public.ai_feature_costs (feature_key, label, points_cost, enabled, block_on_empty)
VALUES ('ai_char_overage', 'AI extra characters', 0, true, true)
ON CONFLICT (feature_key) DO UPDATE
  SET label = EXCLUDED.label,
      enabled = true;
