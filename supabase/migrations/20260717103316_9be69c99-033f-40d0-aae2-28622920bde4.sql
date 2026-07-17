
ALTER TABLE public.admin_portal_settings
  ADD COLUMN IF NOT EXISTS default_ai_monthly_cap numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_ai_fallback_to_general boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_cap_behavior text NOT NULL DEFAULT 'fallback';

ALTER TABLE public.admin_portal_settings
  DROP CONSTRAINT IF EXISTS admin_portal_settings_ai_cap_behavior_check;
ALTER TABLE public.admin_portal_settings
  ADD CONSTRAINT admin_portal_settings_ai_cap_behavior_check
  CHECK (ai_cap_behavior IN ('block','fallback','warn'));
