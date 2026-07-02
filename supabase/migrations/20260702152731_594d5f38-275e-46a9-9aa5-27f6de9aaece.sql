
-- Enforce single admin account
CREATE OR REPLACE FUNCTION public.enforce_single_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.admin_emails) >= 1 THEN
    RAISE EXCEPTION 'only_one_admin_allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_admin ON public.admin_emails;
CREATE TRIGGER trg_single_admin
BEFORE INSERT ON public.admin_emails
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_admin();

-- Track first-login password change requirement (mirrors auth user_metadata for server queries)
-- Not strictly needed since we read from user_metadata client-side, but keep a hint column on companies.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS coordinator_phone text;
