-- Crew Management System — Phase 4 Round 1: merge "corporate" portal kind
-- into a single "Company/Agent Portal" kind (company_agent). "hotel" and
-- "agent" kinds are untouched. Existing corporate portals keep all their
-- data (bookings, magic_token, settings) — only the `kind` value changes.

UPDATE public.portal_companies SET kind = 'company_agent' WHERE kind = 'corporate';

DO $$ BEGIN
  ALTER TABLE public.portal_companies DROP CONSTRAINT IF EXISTS portal_companies_kind_check;
  ALTER TABLE public.portal_companies ADD CONSTRAINT portal_companies_kind_check
    CHECK (kind IN ('hotel', 'agent', 'company_agent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
