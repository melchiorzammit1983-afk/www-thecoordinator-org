
-- 1) Private schema for internal helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

-- 2) Update trigger functions (stay in public) to use search_path that
-- resolves helper functions from either public or private schema.

CREATE OR REPLACE FUNCTION public.enforce_driver_assign_by_executor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $fn$
DECLARE _me uuid;
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    _me := company_of(auth.uid());
    IF _me IS NULL THEN RETURN NEW; END IF;
    IF _me <> COALESCE(NEW.executor_company_id, NEW.company_id) THEN
      RAISE EXCEPTION 'only_current_executor_can_assign_driver';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.enforce_company_owner_update()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'private'
AS $fn$
BEGIN
  IF auth.uid() IS NULL AND current_user = 'service_role' THEN RETURN NEW; END IF;
  IF is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.points_balance IS DISTINCT FROM OLD.points_balance
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'only_admin_can_update_sensitive_company_fields';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.enforce_hop_immutable_fields()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'private'
AS $fn$
BEGIN
  IF is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.hop_index IS DISTINCT FROM OLD.hop_index
     OR NEW.from_company_id IS DISTINCT FROM OLD.from_company_id
     OR NEW.to_company_id IS DISTINCT FROM OLD.to_company_id THEN
    RAISE EXCEPTION 'hop_identifying_fields_are_immutable';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.enforce_jobs_partner_update()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'private'
AS $fn$
DECLARE _me uuid;
BEGIN
  IF is_admin(auth.uid()) THEN RETURN NEW; END IF;
  _me := company_of(auth.uid());
  IF _me IS NULL THEN RETURN NEW; END IF;
  IF _me = OLD.company_id THEN RETURN NEW; END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.origin_company_id IS DISTINCT FROM OLD.origin_company_id
     OR NEW.dispatch_chain_company_ids IS DISTINCT FROM OLD.dispatch_chain_company_ids THEN
    RAISE EXCEPTION 'partners_cannot_change_ownership_fields';
  END IF;
  IF NEW.executor_company_id IS DISTINCT FROM OLD.executor_company_id
     AND _me <> COALESCE(OLD.executor_company_id, OLD.company_id) THEN
    RAISE EXCEPTION 'only_current_executor_can_reassign_executor';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.enforce_driver_self_update()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'private'
AS $fn$
BEGIN
  IF is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF OLD.linked_user_id IS NOT NULL AND OLD.linked_user_id = auth.uid()
     AND NOT is_company_owner(auth.uid(), OLD.company_id) THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id
       OR NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'drivers_cannot_change_identifying_fields';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- 3) Update SECURITY DEFINER caller functions to reference helpers unqualified,
-- with search_path spanning public + private, before moving them.

CREATE OR REPLACE FUNCTION public.charge_feature(_company_id uuid, _feature feature_name, _job_id uuid, _note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $fn$
DECLARE _cost integer; _bal integer;
BEGIN
  IF NOT (is_company_owner(auth.uid(), _company_id) OR is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT points_cost INTO _cost FROM public.feature_costs WHERE feature_name = _feature;
  IF _cost IS NULL THEN _cost := 0; END IF;
  SELECT points_balance INTO _bal FROM public.companies WHERE id = _company_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
  IF _cost > 0 AND _bal < _cost THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  IF _cost > 0 THEN
    UPDATE public.companies SET points_balance = _bal - _cost WHERE id = _company_id;
    _bal := _bal - _cost;
  END IF;
  INSERT INTO public.points_ledger (company_id, job_id, feature_used, points_deducted, note)
  VALUES (_company_id, _job_id, _feature, _cost, _note);
  RETURN _bal;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.dispatch_job_forward(_job_id uuid, _to_company uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $fn$
DECLARE _me uuid; _job record; _next_index int; _partner_ok boolean;
BEGIN
  _me := company_of(auth.uid());
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
END $fn$;

CREATE OR REPLACE FUNCTION public.respond_dispatch(_job_id uuid, _decision text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $fn$
DECLARE _me uuid; _job record; _hop record; _prev uuid;
BEGIN
  _me := company_of(auth.uid());
  IF _me IS NULL THEN RAISE EXCEPTION 'no_company'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF _job IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _job.executor_company_id <> _me THEN RAISE EXCEPTION 'not_your_pending'; END IF;
  SELECT * INTO _hop FROM public.job_dispatch_hops
    WHERE job_id = _job_id AND to_company_id = _me AND status = 'pending'
    ORDER BY hop_index DESC LIMIT 1;
  IF _hop IS NULL THEN RAISE EXCEPTION 'no_pending_hop'; END IF;
  IF _decision = 'accepted' THEN
    UPDATE public.job_dispatch_hops SET status='accepted', decided_at=now(), note=COALESCE(_note,note)
      WHERE id = _hop.id;
    UPDATE public.jobs SET
      company_id = _me,
      dispatch_status = 'accepted',
      dispatch_decided_at = now(),
      dispatch_note = COALESCE(_note, dispatch_note)
    WHERE id = _job_id;
  ELSIF _decision = 'rejected' THEN
    _prev := _hop.from_company_id;
    UPDATE public.job_dispatch_hops SET status='rejected', decided_at=now(), note=COALESCE(_note,note)
      WHERE id = _hop.id;
    UPDATE public.jobs SET
      executor_company_id = _prev,
      dispatch_status = 'rejected',
      dispatch_decided_at = now(),
      dispatch_note = COALESCE(_note, dispatch_note),
      dispatch_chain_company_ids = array_remove(dispatch_chain_company_ids, _me)
    WHERE id = _job_id;
  ELSE
    RAISE EXCEPTION 'bad_decision';
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.job_in_my_chain(_job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job_id
      AND company_of(auth.uid()) = ANY(j.dispatch_chain_company_ids)
  );
$fn$;

-- 4) Move the 14 flagged SECURITY DEFINER functions to the private schema.
-- OIDs are preserved so policies, triggers, and function-to-function
-- references (already stored by OID) continue to resolve.

ALTER FUNCTION public.charge_feature(uuid, feature_name, uuid, text) SET SCHEMA private;
ALTER FUNCTION public.company_of(uuid) SET SCHEMA private;
ALTER FUNCTION public.dispatch_job_forward(uuid, uuid, text) SET SCHEMA private;
ALTER FUNCTION public.driver_accept_job(text, uuid) SET SCHEMA private;
ALTER FUNCTION public.driver_approve_deletion(text, uuid) SET SCHEMA private;
ALTER FUNCTION public.driver_save_profile(text, text, text, text, text, integer) SET SCHEMA private;
ALTER FUNCTION public.has_connection_permission(uuid, uuid, text) SET SCHEMA private;
ALTER FUNCTION public.has_feature(uuid, text) SET SCHEMA private;
ALTER FUNCTION public.is_admin(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_company_owner(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.is_executor_of(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.job_in_my_chain(uuid) SET SCHEMA private;
ALTER FUNCTION public.lookup_magic_link(text) SET SCHEMA private;
ALTER FUNCTION public.respond_dispatch(uuid, text, text) SET SCHEMA private;
