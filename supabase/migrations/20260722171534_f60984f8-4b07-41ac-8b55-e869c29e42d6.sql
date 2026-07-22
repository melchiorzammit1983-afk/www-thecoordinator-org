
DROP FUNCTION IF EXISTS public.record_trip_audit(uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric, timestamptz, uuid, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.record_trip_audit(
  _job_id uuid,
  _event_type text,
  _previous jsonb DEFAULT NULL,
  _new jsonb DEFAULT NULL,
  _notes text DEFAULT NULL,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _accuracy numeric DEFAULT NULL,
  _address text DEFAULT NULL,
  _speed numeric DEFAULT NULL,
  _device_time timestamptz DEFAULT NULL,
  _group_id uuid DEFAULT NULL,
  _stop_id uuid DEFAULT NULL,
  _approval_status text DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _actor_label text DEFAULT NULL,
  _actor_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _company_id uuid;
  _company_owner uuid;
  _job_driver uuid;
  _resolved_driver uuid := _driver_id;
  _actor uuid := COALESCE(auth.uid(), _actor_user_id);
  _label text := _actor_label;
  _prev_hash text;
  _canonical text;
  _hash text;
  _payload jsonb;
  _approval text;
  _new_id uuid;
  _authorized boolean := false;
BEGIN
  IF _job_id IS NOT NULL THEN
    SELECT company_id, driver_id, COALESCE(_resolved_driver, driver_id)
      INTO _company_id, _job_driver, _resolved_driver
      FROM public.jobs WHERE id = _job_id;
  END IF;

  IF _company_id IS NULL AND _group_id IS NOT NULL THEN
    SELECT j.company_id, j.driver_id INTO _company_id, _job_driver
      FROM public.groups g JOIN public.jobs j ON j.id = g.job_id
      WHERE g.id = _group_id;
  END IF;

  IF _company_id IS NULL THEN
    RAISE WARNING 'record_trip_audit: cannot resolve company_id for job %', _job_id;
    RETURN NULL;
  END IF;

  -- When invoked via a bearer-authenticated session (auth.uid() present),
  -- enforce that the caller is admin / company owner / assigned driver.
  -- When invoked via service_role (auth.uid() NULL), the caller is a trusted
  -- server function which has already authorized the actor.
  IF auth.uid() IS NOT NULL THEN
    IF private.is_admin(auth.uid()) THEN
      _authorized := true;
    ELSE
      SELECT owner_user_id INTO _company_owner FROM public.companies WHERE id = _company_id;
      IF _company_owner = auth.uid() THEN
        _authorized := true;
      ELSIF _job_driver IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = _job_driver AND d.linked_user_id = auth.uid()
      ) THEN
        _authorized := true;
      END IF;
    END IF;
    IF NOT _authorized THEN
      RAISE EXCEPTION 'record_trip_audit: not authorized for job %', _job_id USING ERRCODE = '42501';
    END IF;
  END IF;

  _approval := COALESCE(_approval_status,
    CASE
      WHEN _event_type LIKE 'override_%'          THEN 'overridden'
      WHEN _event_type = 'safety_concern'         THEN 'overridden'
      WHEN _event_type = 'breakdown'              THEN 'overridden'
      WHEN _event_type = 'boarding_approved'      THEN 'approved'
      WHEN _event_type = 'stop_reorder_requested' THEN 'pending'
      WHEN _event_type = 'wait_charge_changed'    THEN 'approved'
      ELSE 'not_required'
    END
  );

  IF _label IS NULL THEN
    IF _actor IS NULL THEN _label := 'system';
    ELSIF private.is_admin(_actor) THEN _label := 'admin';
    ELSE _label := 'coordinator';
    END IF;
  END IF;

  IF _job_id IS NOT NULL THEN
    SELECT row_hash INTO _prev_hash
      FROM public.trip_audit_log
      WHERE job_id = _job_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE;
  END IF;

  _payload := jsonb_build_object(
    'company_id',      _company_id,
    'job_id',          _job_id,
    'group_id',        _group_id,
    'stop_id',         _stop_id,
    'driver_id',       _resolved_driver,
    'actor_user_id',   _actor,
    'actor_label',     _label,
    'event_type',      _event_type,
    'approval_status', _approval,
    'previous_state',  _previous,
    'new_state',       _new,
    'notes',           _notes,
    'gps_lat',         _lat,
    'gps_lng',         _lng,
    'gps_accuracy_m',  _accuracy,
    'street_address',  _address,
    'speed_kmh',       _speed,
    'device_time',     _device_time,
    'server_time',     now()
  );

  _canonical := public.canonical_jsonb(_payload);
  _hash := encode(digest(COALESCE(_prev_hash, '') || _canonical, 'sha256'), 'hex');

  INSERT INTO public.trip_audit_log (
    company_id, job_id, group_id, stop_id, driver_id,
    actor_user_id, actor_label, event_type, approval_status,
    previous_state, new_state, notes,
    gps_lat, gps_lng, gps_accuracy_m, street_address, speed_kmh,
    device_time, prev_hash, row_hash
  ) VALUES (
    _company_id, _job_id, _group_id, _stop_id, _resolved_driver,
    _actor, _label, _event_type, _approval,
    _previous, _new, _notes,
    _lat, _lng, _accuracy, _address, _speed,
    _device_time, _prev_hash, _hash
  ) RETURNING id INTO _new_id;

  RETURN _new_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'record_trip_audit failed: %', SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_trip_audit(uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric, timestamptz, uuid, uuid, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_trip_audit(uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric, timestamptz, uuid, uuid, text, uuid, text, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.record_trip_audit(uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric, timestamptz, uuid, uuid, text, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_trip_audit(uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric, timestamptz, uuid, uuid, text, uuid, text, uuid) TO service_role;
