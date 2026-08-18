-- Connect reusable Portal Builder templates to company portals and add
-- server-only, first-visit client password protection.

ALTER TABLE public.portal_companies
  ADD COLUMN IF NOT EXISTS portal_definition_id uuid
    REFERENCES public.portals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS password_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS portal_companies_definition_idx
  ON public.portal_companies (portal_definition_id)
  WHERE portal_definition_id IS NOT NULL;

-- Serialize same-company/name writes so two simultaneous requests cannot
-- create two active portals for the same client. Existing archived records
-- remain available for statements and audit history.
CREATE OR REPLACE FUNCTION public.enforce_one_active_company_portal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.active THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        NEW.coordinator_company_id::text || ':' || lower(btrim(NEW.name)),
        0
      )
    );
    IF EXISTS (
      SELECT 1
      FROM public.portal_companies AS existing
      WHERE existing.coordinator_company_id = NEW.coordinator_company_id
        AND existing.active
        AND lower(btrim(existing.name)) = lower(btrim(NEW.name))
        AND existing.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'This company already has an active portal.'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_one_active_company_portal()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_portal_companies_one_active_company
  ON public.portal_companies;
CREATE TRIGGER trg_portal_companies_one_active_company
  BEFORE INSERT OR UPDATE OF active, name, coordinator_company_id
  ON public.portal_companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_one_active_company_portal();

-- Password hashes and lockout state must never be readable by browser roles.
-- The public server routes use the server-only service client for this table.
CREATE TABLE IF NOT EXISTS public.portal_company_passwords (
  portal_company_id uuid PRIMARY KEY
    REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0
    CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_portal_company_passwords_touch_updated_at
  ON public.portal_company_passwords;
CREATE TRIGGER trg_portal_company_passwords_touch_updated_at
  BEFORE UPDATE ON public.portal_company_passwords
  FOR EACH ROW EXECUTE FUNCTION public.touch_transport_updated_at();

ALTER TABLE public.portal_company_passwords ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.portal_company_passwords FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portal_company_passwords TO service_role;

-- Failed-attempt updates are atomic, including automatic reset after an
-- expired lock, so parallel login requests cannot bypass the five-try limit.
CREATE OR REPLACE FUNCTION public.record_portal_password_failure(
  p_portal_company_id uuid
)
RETURNS TABLE (failed_attempts integer, locked_until timestamptz)
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.portal_company_passwords AS password
  SET
    failed_attempts = CASE
      WHEN password.locked_until IS NOT NULL AND password.locked_until <= now() THEN 1
      ELSE least(5, password.failed_attempts + 1)
    END,
    locked_until = CASE
      WHEN (
        CASE
          WHEN password.locked_until IS NOT NULL AND password.locked_until <= now() THEN 1
          ELSE least(5, password.failed_attempts + 1)
        END
      ) >= 5 THEN now() + interval '15 minutes'
      ELSE NULL
    END
  WHERE password.portal_company_id = p_portal_company_id
  RETURNING password.failed_attempts, password.locked_until;
$$;

REVOKE ALL ON FUNCTION public.record_portal_password_failure(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_portal_password_failure(uuid)
  TO service_role;

COMMENT ON TABLE public.portal_company_passwords IS
  'Server-only password hashes and temporary lockout state for company portals.';
COMMENT ON COLUMN public.portal_companies.password_required IS
  'When true, the first client to open the secure portal link must create its password.';
