
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE public.portal_companies
  ADD COLUMN IF NOT EXISTS slug citext;

ALTER TABLE public.portal_companies
  DROP CONSTRAINT IF EXISTS portal_companies_slug_check;
ALTER TABLE public.portal_companies
  ADD CONSTRAINT portal_companies_slug_check
  CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

-- Backfill missing slugs from name
DO $$
DECLARE r record; base text; candidate text; n int;
BEGIN
  FOR r IN SELECT id, name FROM public.portal_companies WHERE slug IS NULL LOOP
    base := regexp_replace(lower(coalesce(r.name, 'portal')), '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '(^-+|-+$)', '', 'g');
    IF length(base) < 3 THEN base := base || 'co'; END IF;
    IF length(base) > 38 THEN base := substring(base from 1 for 38); END IF;
    candidate := base;
    n := 1;
    WHILE EXISTS(SELECT 1 FROM public.portal_companies WHERE slug = candidate::citext) LOOP
      n := n + 1;
      candidate := substring(base from 1 for 36) || '-' || n::text;
    END LOOP;
    UPDATE public.portal_companies SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS portal_companies_slug_key ON public.portal_companies (slug);
