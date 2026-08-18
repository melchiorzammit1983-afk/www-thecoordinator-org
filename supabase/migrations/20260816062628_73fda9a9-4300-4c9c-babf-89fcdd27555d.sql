-- Clean branded portal links: /<coordinator-slug>/<portal-slug>

CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION public.web_slugify(_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    trim(both '-' from regexp_replace(lower(coalesce(_input, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

-- 1) companies.slug -----------------------------------------------------
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS slug citext;

WITH base AS (
  SELECT id,
         COALESCE(left(public.web_slugify(name), 32), 'co') AS s
  FROM public.companies
  WHERE slug IS NULL
), numbered AS (
  SELECT id, s,
         row_number() OVER (PARTITION BY s ORDER BY id) AS rn
  FROM base
)
UPDATE public.companies c
SET slug = CASE
  WHEN length(n.s) < 3 THEN n.s || '-co' || CASE WHEN n.rn > 1 THEN n.rn::text ELSE '' END
  WHEN n.rn = 1 THEN n.s
  ELSE n.s || '-' || n.rn::text
END
FROM numbered n
WHERE c.id = n.id;

-- guarantee uniqueness even against pre-existing values
DO $$
DECLARE r record; candidate text; i int;
BEGIN
  FOR r IN
    SELECT id, slug FROM public.companies WHERE slug IS NOT NULL
  LOOP
    IF (SELECT count(*) FROM public.companies x WHERE x.slug = r.slug) > 1 THEN
      i := 1;
      LOOP
        candidate := r.slug::text || '-' || i::text;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies x WHERE x.slug = candidate::citext);
        i := i + 1;
      END LOOP;
      UPDATE public.companies SET slug = candidate::citext WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_key ON public.companies (slug);

-- 2) portal_companies.portal_slug ---------------------------------------
ALTER TABLE public.portal_companies ADD COLUMN IF NOT EXISTS portal_slug citext;

WITH base AS (
  SELECT id, coordinator_company_id,
         COALESCE(
           left(public.web_slugify(regexp_replace(coalesce(slug::text, ''), '-[0-9a-f]{16}(-[0-9]+)?$', '')), 40),
           left(public.web_slugify(name), 40),
           'portal'
         ) AS s
  FROM public.portal_companies
  WHERE portal_slug IS NULL
), numbered AS (
  SELECT id, coordinator_company_id, s,
         row_number() OVER (PARTITION BY coordinator_company_id, s ORDER BY id) AS rn
  FROM base
)
UPDATE public.portal_companies p
SET portal_slug = CASE
  WHEN length(n.s) < 3 THEN n.s || '-portal' || CASE WHEN n.rn > 1 THEN n.rn::text ELSE '' END
  WHEN n.rn = 1 THEN n.s
  ELSE n.s || '-' || n.rn::text
END
FROM numbered n
WHERE p.id = n.id;

DO $$
DECLARE r record; candidate text; i int;
BEGIN
  FOR r IN
    SELECT id, coordinator_company_id, portal_slug
    FROM public.portal_companies WHERE portal_slug IS NOT NULL
  LOOP
    IF (SELECT count(*) FROM public.portal_companies x
        WHERE x.coordinator_company_id = r.coordinator_company_id
          AND x.portal_slug = r.portal_slug) > 1 THEN
      i := 1;
      LOOP
        candidate := r.portal_slug::text || '-' || i::text;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.portal_companies x
          WHERE x.coordinator_company_id = r.coordinator_company_id
            AND x.portal_slug = candidate::citext
        );
        i := i + 1;
      END LOOP;
      UPDATE public.portal_companies SET portal_slug = candidate::citext WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS portal_companies_coord_portal_slug_key
  ON public.portal_companies (coordinator_company_id, portal_slug);