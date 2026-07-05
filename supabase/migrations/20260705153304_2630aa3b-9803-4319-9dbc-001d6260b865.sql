
-- company_logos table
CREATE TABLE IF NOT EXISTS public.company_logos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_background BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_logos_company_idx ON public.company_logos(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_logos TO authenticated;
GRANT ALL ON public.company_logos TO service_role;

ALTER TABLE public.company_logos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company owner read own logos" ON public.company_logos
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
  );

CREATE POLICY "company owner insert own logos" ON public.company_logos
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
  );

CREATE POLICY "company owner update own logos" ON public.company_logos
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
  );

CREATE POLICY "company owner delete own logos" ON public.company_logos
  FOR DELETE TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_user_id = auth.uid())
  );

CREATE TRIGGER trg_company_logos_updated_at
  BEFORE UPDATE ON public.company_logos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage RLS on the private 'company-logos' bucket
CREATE POLICY "company_logos_owner_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies WHERE owner_user_id = auth.uid()
  )
);

CREATE POLICY "company_logos_owner_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies WHERE owner_user_id = auth.uid()
  )
);

CREATE POLICY "company_logos_owner_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies WHERE owner_user_id = auth.uid()
  )
);

CREATE POLICY "company_logos_owner_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies WHERE owner_user_id = auth.uid()
  )
);

-- jobs.board_config for saved boards
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS board_config JSONB;

-- Seed the billable weekly extra-logos feature (editable from Admin AI & Features Pricing)
INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled)
VALUES ('extra_company_logos_weekly', 20, true)
ON CONFLICT (feature_key) DO NOTHING;

-- Weekly billing function
CREATE OR REPLACE FUNCTION public.charge_extra_logos_weekly()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row record;
  _charged integer := 0;
BEGIN
  FOR _row IN
    SELECT company_id, count(*) AS n
    FROM public.company_logos
    WHERE COALESCE(is_background, false) = false
    GROUP BY company_id
    HAVING count(*) > 5
  LOOP
    BEGIN
      PERFORM public.spend_points(
        _row.company_id,
        'extra_company_logos_weekly',
        NULL::uuid,
        'weekly extra-logos fee (flat, ' || _row.n || ' logos)',
        NULL::numeric
      );
      _charged := _charged + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- skip on insufficient_points / feature_disabled
    END;
  END LOOP;
  RETURN _charged;
END;
$$;

-- Schedule weekly (Monday 03:00 UTC)
DO $$
BEGIN
  PERFORM cron.unschedule('charge-extra-logos-weekly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'charge-extra-logos-weekly',
  '0 3 * * 1',
  $cron$ SELECT public.charge_extra_logos_weekly(); $cron$
);
