
-- 1. trip_messages thread tag
ALTER TABLE public.trip_messages
  ADD COLUMN IF NOT EXISTS thread text NOT NULL DEFAULT 'chain'
    CHECK (thread IN ('chain','coord_driver','coord_client','driver_client'));

CREATE INDEX IF NOT EXISTS trip_messages_job_thread_idx
  ON public.trip_messages(job_id, thread, created_at DESC);

-- 2. driver onboarding fields
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS car_make_model text,
  ADD COLUMN IF NOT EXISTS plate text,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- 3. mark external driver on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS driver_external boolean NOT NULL DEFAULT false;

-- 4. dispatch_job_forward: require active partnership
CREATE OR REPLACE FUNCTION public.dispatch_job_forward(_job_id uuid, _to_company uuid, _note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid; _job record; _next_index int; _partner_ok boolean;
BEGIN
  _me := public.company_of(auth.uid());
  IF _me IS NULL THEN RAISE EXCEPTION 'no_company'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF _job IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF COALESCE(_job.executor_company_id, _job.company_id) <> _me THEN
    RAISE EXCEPTION 'only_current_executor_can_dispatch';
  END IF;
  IF _to_company = _me THEN RAISE EXCEPTION 'cannot_dispatch_to_self'; END IF;
  IF _to_company = ANY(_job.dispatch_chain_company_ids) THEN
    RAISE EXCEPTION 'cycle_detected';
  END IF;

  -- must be actively connected partners
  SELECT EXISTS (
    SELECT 1 FROM public.coordinator_connections c
    WHERE c.status = 'active'
      AND (
        (c.owner_company_id = _me AND c.partner_company_id = _to_company)
        OR (c.partner_company_id = _me AND c.owner_company_id = _to_company)
      )
  ) INTO _partner_ok;
  IF NOT _partner_ok THEN RAISE EXCEPTION 'not_a_partner'; END IF;

  SELECT COALESCE(MAX(hop_index), -1) + 1 INTO _next_index
    FROM public.job_dispatch_hops WHERE job_id = _job_id;
  INSERT INTO public.job_dispatch_hops(job_id, hop_index, from_company_id, to_company_id, status, note)
  VALUES (_job_id, _next_index, _me, _to_company, 'pending', _note);
  UPDATE public.jobs SET
    origin_company_id = COALESCE(origin_company_id, company_id),
    executor_company_id = _to_company,
    dispatch_status = 'pending',
    dispatched_at = now(),
    dispatch_decided_at = NULL,
    dispatch_note = _note,
    dispatch_chain_company_ids = dispatch_chain_company_ids || _to_company
  WHERE id = _job_id;
END $function$;

-- 5. trigger: keep driver_external in sync
CREATE OR REPLACE FUNCTION public.sync_driver_external()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _driver_company uuid;
BEGIN
  IF NEW.driver_id IS NULL THEN
    NEW.driver_external := false;
    RETURN NEW;
  END IF;
  SELECT company_id INTO _driver_company FROM public.drivers WHERE id = NEW.driver_id;
  NEW.driver_external := (_driver_company IS DISTINCT FROM COALESCE(NEW.executor_company_id, NEW.company_id));
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS jobs_sync_driver_external ON public.jobs;
CREATE TRIGGER jobs_sync_driver_external
  BEFORE INSERT OR UPDATE OF driver_id, executor_company_id, company_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_driver_external();

-- 6. Save driver profile via magic-link token (used by /m.driver.$token onboarding)
CREATE OR REPLACE FUNCTION public.driver_save_profile(
  _token text,
  _name text,
  _phone text,
  _car text,
  _plate text,
  _seats int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _link record;
BEGIN
  SELECT * INTO _link FROM public.magic_links
    WHERE token = _token AND kind = 'driver'
      AND (expires_at IS NULL OR expires_at > now())
      AND revoked_at IS NULL;
  IF _link IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF _link.subject_id IS NULL THEN RAISE EXCEPTION 'no_driver_on_link'; END IF;
  IF length(coalesce(_name,'')) = 0 OR length(_name) > 120 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF length(coalesce(_phone,'')) = 0 OR length(_phone) > 40 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  UPDATE public.drivers
    SET name = _name,
        phone = _phone,
        car_make_model = NULLIF(_car, ''),
        plate = NULLIF(_plate, ''),
        seats_available = COALESCE(_seats, seats_available),
        onboarded_at = COALESCE(onboarded_at, now())
    WHERE id = _link.subject_id AND company_id = _link.company_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.driver_save_profile(text,text,text,text,text,int) TO anon, authenticated;
