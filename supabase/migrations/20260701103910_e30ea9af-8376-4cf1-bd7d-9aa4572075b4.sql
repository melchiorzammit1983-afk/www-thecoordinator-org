
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS driver_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid;

-- Allow drivers with a valid manifest magic link to accept or approve deletion.
-- Public function used by the driver manifest (token-gated in the app layer).
CREATE OR REPLACE FUNCTION public.driver_accept_job(_token text, _job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _link record; _job record;
BEGIN
  SELECT * INTO _link FROM public.magic_links
    WHERE token = _token AND kind = 'driver'
      AND (expires_at IS NULL OR expires_at > now())
      AND revoked_at IS NULL;
  IF _link IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id AND company_id = _link.company_id;
  IF _job IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _link.subject_id IS NOT NULL AND _job.driver_id IS DISTINCT FROM _link.subject_id THEN
    RAISE EXCEPTION 'not_your_job';
  END IF;
  UPDATE public.jobs SET driver_accepted_at = COALESCE(driver_accepted_at, now())
    WHERE id = _job_id;
END $$;

CREATE OR REPLACE FUNCTION public.driver_approve_deletion(_token text, _job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _link record; _job record;
BEGIN
  SELECT * INTO _link FROM public.magic_links
    WHERE token = _token AND kind = 'driver'
      AND (expires_at IS NULL OR expires_at > now())
      AND revoked_at IS NULL;
  IF _link IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id AND company_id = _link.company_id;
  IF _job IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _link.subject_id IS NOT NULL AND _job.driver_id IS DISTINCT FROM _link.subject_id THEN
    RAISE EXCEPTION 'not_your_job';
  END IF;
  IF _job.deletion_requested_at IS NULL THEN
    RAISE EXCEPTION 'no_deletion_requested';
  END IF;
  DELETE FROM public.jobs WHERE id = _job_id;
END $$;

GRANT EXECUTE ON FUNCTION public.driver_accept_job(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_approve_deletion(text, uuid) TO anon, authenticated;
